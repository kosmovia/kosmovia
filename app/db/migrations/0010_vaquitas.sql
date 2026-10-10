-- Kosmovia · Vaquita: un pozo común dentro de una comunidad.
--
-- Alguien crea "Asado del sábado – meta 50 USDC – hasta el viernes" y los
-- miembros aportan USDC. La Vaquita NO mueve dinero por su cuenta: cada aporte
-- es un pago normal (con PIN) a la wallet de quien creó la vaquita, y después se
-- "vincula" ese pago registrado a la vaquita (vaquita_contributions). Un pago
-- aporta a una sola vaquita (payment_id único).
--
-- Lo recaudado y la cantidad de aportantes NO se guardan: se calculan sumando
-- los aportes.
--
-- Cuotas (triggers, como las otras): máximo 20 vaquitas abiertas por comunidad
-- y 10 creaciones por hora por perfil.
--
-- Idempotente: se puede volver a correr sin romper nada.

-- ---------------------------------------------------------------------------
-- vaquitas
-- ---------------------------------------------------------------------------

create table if not exists public.vaquitas (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  creator_id   uuid not null references public.profiles (id) on delete cascade,
  title        text not null,
  description  text null,
  goal_usdc    numeric(20, 7) not null,
  deadline     timestamptz null,
  status       text not null default 'open',
  created_at   timestamptz not null default now(),
  closed_at    timestamptz null
);

alter table public.vaquitas drop constraint if exists vaquitas_title_len;
alter table public.vaquitas add constraint vaquitas_title_len
  check (char_length(title) between 1 and 60);
alter table public.vaquitas drop constraint if exists vaquitas_description_len;
alter table public.vaquitas add constraint vaquitas_description_len
  check (description is null or char_length(description) between 1 and 280);
alter table public.vaquitas drop constraint if exists vaquitas_goal_range;
alter table public.vaquitas add constraint vaquitas_goal_range
  check (goal_usdc > 0 and goal_usdc <= 100000);
alter table public.vaquitas drop constraint if exists vaquitas_status_check;
alter table public.vaquitas add constraint vaquitas_status_check
  check (status in ('open', 'closed'));
alter table public.vaquitas drop constraint if exists vaquitas_closed_at_matches_status;
alter table public.vaquitas add constraint vaquitas_closed_at_matches_status
  check ((status = 'closed') = (closed_at is not null));

create index if not exists vaquitas_community_created_idx
  on public.vaquitas (community_id, created_at desc);
create index if not exists vaquitas_creator_created_idx
  on public.vaquitas (creator_id, created_at desc);

-- ---------------------------------------------------------------------------
-- vaquita_contributions
-- ---------------------------------------------------------------------------

create table if not exists public.vaquita_contributions (
  id             uuid primary key default gen_random_uuid(),
  vaquita_id     uuid not null references public.vaquitas (id) on delete cascade,
  payment_id     uuid not null references public.payments (id) on delete cascade,
  contributor_id uuid not null references public.profiles (id) on delete cascade,
  amount_usdc    numeric(20, 7) not null,
  created_at     timestamptz not null default now()
);

-- Un pago aporta a una sola vaquita.
alter table public.vaquita_contributions drop constraint if exists vaquita_contributions_payment_key;
alter table public.vaquita_contributions add constraint vaquita_contributions_payment_key
  unique (payment_id);
alter table public.vaquita_contributions drop constraint if exists vaquita_contributions_amount_positive;
alter table public.vaquita_contributions add constraint vaquita_contributions_amount_positive
  check (amount_usdc > 0);

create index if not exists vaquita_contributions_vaquita_idx
  on public.vaquita_contributions (vaquita_id, created_at desc);
create index if not exists vaquita_contributions_contributor_idx
  on public.vaquita_contributions (contributor_id);

-- ---------------------------------------------------------------------------
-- Cuotas
-- ---------------------------------------------------------------------------

create or replace function public.enforce_vaquita_quota()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_open integer;
  v_hour integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('kosmovia:vaquitas:' || new.community_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('kosmovia:vaquitas_creator:' || new.creator_id::text, 0));

  select count(*) into v_open
  from public.vaquitas v
  where v.community_id = new.community_id and v.status = 'open';
  if v_open >= 20 then
    raise exception 'quota_exceeded:vaquitas_open_per_community'
      using errcode = 'P0001', hint = 'Maximo 20 vaquitas abiertas por comunidad.';
  end if;

  select count(*) into v_hour
  from public.vaquitas v
  where v.creator_id = new.creator_id and v.created_at > now() - interval '1 hour';
  if v_hour >= 10 then
    raise exception 'quota_exceeded:vaquitas_per_hour'
      using errcode = 'P0001', hint = 'Maximo 10 vaquitas por hora por perfil.';
  end if;

  return new;
end;
$$;

drop trigger if exists vaquitas_before_insert_quota on public.vaquitas;
create trigger vaquitas_before_insert_quota
before insert on public.vaquitas
for each row execute function public.enforce_vaquita_quota();
