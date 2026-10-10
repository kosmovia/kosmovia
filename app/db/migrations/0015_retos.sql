-- Kosmovia · Retos: juegos simples entre amigos de una comunidad.
--
-- A reta a B (los dos miembros de la misma comunidad) a tres en raya (ttt) o a
-- piedra, papel o tijera al mejor de 3 (ppt). B acepta o rechaza; si acepta,
-- juegan por turnos asincrónicos. SIN dinero en juego: solo puntos por
-- comunidad (ganar 3, empatar 1, perder 0), que se calculan a partir de los
-- retos terminados (no se guardan).
--
-- `state` (jsonb) lo escribe solo el servidor:
--   ttt: { "board": [null|"X"|"O" x 9] }  (quien reta es X y empieza)
--   ppt: { "rounds": [{ "c": jugada de quien reta, "o": jugada del retado }] }
-- En ppt las jugadas pendientes se guardan aquí, ocultas: la API nunca devuelve
-- la jugada de la otra persona hasta que las dos jugaron la ronda.
--
-- Caducidad (la aplica el servidor al consultar): un reto pendiente caduca a las
-- 24 h de creado; una partida sin jugar 24 h la gana quien no abandonó.
--
-- Cuotas (trigger): máximo 10 retos pendientes por perfil y 30 creados por hora.
-- Un solo reto abierto (pendiente o activo) por pareja y juego en una comunidad.
--
-- Idempotente: se puede volver a correr sin romper nada.

create table if not exists public.retos (
  id              uuid primary key default gen_random_uuid(),
  community_id    uuid not null references public.communities (id) on delete cascade,
  game            text not null,
  challenger_id   uuid not null references public.profiles (id) on delete cascade,
  opponent_id     uuid not null references public.profiles (id) on delete cascade,
  status          text not null default 'pending',
  state           jsonb not null default '{}'::jsonb,
  turn_profile_id uuid null references public.profiles (id) on delete set null,
  winner_id       uuid null references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  finished_at     timestamptz null
);

alter table public.retos drop constraint if exists retos_game_check;
alter table public.retos add constraint retos_game_check
  check (game in ('ttt', 'ppt'));
alter table public.retos drop constraint if exists retos_status_check;
alter table public.retos add constraint retos_status_check
  check (status in ('pending', 'active', 'finished', 'declined', 'expired'));
alter table public.retos drop constraint if exists retos_not_self;
alter table public.retos add constraint retos_not_self
  check (challenger_id <> opponent_id);
alter table public.retos drop constraint if exists retos_state_object;
alter table public.retos add constraint retos_state_object
  check (jsonb_typeof(state) = 'object');
alter table public.retos drop constraint if exists retos_winner_is_player;
alter table public.retos add constraint retos_winner_is_player
  check (winner_id is null or winner_id in (challenger_id, opponent_id));
alter table public.retos drop constraint if exists retos_winner_only_finished;
alter table public.retos add constraint retos_winner_only_finished
  check (winner_id is null or status = 'finished');
alter table public.retos drop constraint if exists retos_turn_is_player;
alter table public.retos add constraint retos_turn_is_player
  check (turn_profile_id is null or turn_profile_id in (challenger_id, opponent_id));
alter table public.retos drop constraint if exists retos_finished_at_matches_status;
alter table public.retos add constraint retos_finished_at_matches_status
  check ((status in ('pending', 'active')) = (finished_at is null));

create index if not exists retos_community_updated_idx
  on public.retos (community_id, updated_at desc);
create index if not exists retos_challenger_idx
  on public.retos (challenger_id, status, created_at desc);
create index if not exists retos_opponent_idx
  on public.retos (opponent_id, status, created_at desc);
-- Para la tabla de posiciones: solo los terminados.
create index if not exists retos_finished_idx
  on public.retos (community_id) where status = 'finished';

-- Un reto abierto por pareja (sin importar quién retó) y juego en cada comunidad.
create unique index if not exists retos_open_pair_key
  on public.retos (community_id, game, least(challenger_id, opponent_id), greatest(challenger_id, opponent_id))
  where status in ('pending', 'active');

-- ---------------------------------------------------------------------------
-- Cuotas
-- ---------------------------------------------------------------------------

create or replace function public.enforce_reto_quota()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_pending integer;
  v_hour    integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('kosmovia:retos:' || new.challenger_id::text, 0));

  -- Un pendiente de más de 24 h ya caducó aunque nadie lo haya marcado todavía.
  select count(*) into v_pending
  from public.retos r
  where r.challenger_id = new.challenger_id
    and r.status = 'pending'
    and r.created_at > now() - interval '24 hours';
  if v_pending >= 10 then
    raise exception 'quota_exceeded:retos_pending'
      using errcode = 'P0001', hint = 'Maximo 10 retos pendientes por perfil.';
  end if;

  select count(*) into v_hour
  from public.retos r
  where r.challenger_id = new.challenger_id and r.created_at > now() - interval '1 hour';
  if v_hour >= 30 then
    raise exception 'quota_exceeded:retos_per_hour'
      using errcode = 'P0001', hint = 'Maximo 30 retos por hora por perfil.';
  end if;

  return new;
end;
$$;

drop trigger if exists retos_before_insert_quota on public.retos;
create trigger retos_before_insert_quota
before insert on public.retos
for each row execute function public.enforce_reto_quota();
