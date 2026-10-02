-- Kosmovia core · Etapa A · endurecimiento (revision de seguridad).
-- Aplicar DESPUES de 0001_stage_a.sql. No reescribe 0001.
--
--   1. Cuotas atomicas en la base (triggers BEFORE INSERT): comunidades,
--      mensajes y canales ya no se pueden inundar escribiendo directo a Supabase.
--   2. CHECKs de avatar y de otros textos sin tope.
--   3. Una cuenta de X = un perfil (indice unico parcial).
--   4. Rol `kosmovia_verifier`: el camino de confianza (sin service_role) con el
--      que el servidor guarda el resultado de verificar X.
--
-- Los mensajes de error de las cuotas empiezan con `quota_exceeded:` (SQLSTATE
-- P0001) para que el cliente los reconozca.

-- ---------------------------------------------------------------------------
-- 1. Cuotas
-- Cada funcion toma un advisory lock de transaccion por usuario (o por
-- comunidad) antes de contar: dos inserts simultaneos del mismo usuario se
-- serializan, asi que no se pueden colar los dos por la misma ventana.
-- SECURITY DEFINER para contar sin pasar por RLS; search_path vacio.
-- ---------------------------------------------------------------------------

-- Indices para que los conteos sean un rango de indice, no un escaneo.
create index if not exists communities_owner_created_idx on public.communities (owner_id, created_at);
create index if not exists messages_author_created_idx on public.messages (author_id, created_at);
-- channels_community_id_idx ya existe en 0001.

-- Comunidades: maximo 3 creadas en 24 h y 10 en total por perfil.
create or replace function public.enforce_community_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day   integer;
  v_total integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('kosmovia:communities:' || new.owner_id::text, 0));

  select count(*) filter (where c.created_at > now() - interval '24 hours'), count(*)
    into v_day, v_total
  from public.communities c
  where c.owner_id = new.owner_id;

  if v_total >= 10 then
    raise exception 'quota_exceeded:communities_total'
      using errcode = 'P0001', hint = 'Maximo 10 comunidades por perfil.';
  end if;
  if v_day >= 3 then
    raise exception 'quota_exceeded:communities_per_day'
      using errcode = 'P0001', hint = 'Maximo 3 comunidades nuevas cada 24 horas.';
  end if;
  return new;
end;
$$;

create trigger communities_before_insert_quota
before insert on public.communities
for each row execute function public.enforce_community_quota();

-- Mensajes: maximo 20 por minuto y 500 por hora por autor.
create or replace function public.enforce_message_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_minute integer;
  v_hour   integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('kosmovia:messages:' || new.author_id::text, 0));

  select count(*) filter (where m.created_at > now() - interval '1 minute'), count(*)
    into v_minute, v_hour
  from public.messages m
  where m.author_id = new.author_id
    and m.created_at > now() - interval '1 hour';

  if v_minute >= 20 then
    raise exception 'quota_exceeded:messages_per_minute'
      using errcode = 'P0001', hint = 'Maximo 20 mensajes por minuto.';
  end if;
  if v_hour >= 500 then
    raise exception 'quota_exceeded:messages_per_hour'
      using errcode = 'P0001', hint = 'Maximo 500 mensajes por hora.';
  end if;
  return new;
end;
$$;

create trigger messages_before_insert_quota
before insert on public.messages
for each row execute function public.enforce_message_quota();

-- Canales: maximo 50 por comunidad (incluye los 2 que crea el trigger de 0001).
create or replace function public.enforce_channel_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('kosmovia:channels:' || new.community_id::text, 0));

  select count(*) into v_count
  from public.channels ch
  where ch.community_id = new.community_id;

  if v_count >= 50 then
    raise exception 'quota_exceeded:channels_per_community'
      using errcode = 'P0001', hint = 'Maximo 50 canales por comunidad.';
  end if;
  return new;
end;
$$;

create trigger channels_before_insert_quota
before insert on public.channels
for each row execute function public.enforce_channel_quota();

revoke all on function public.enforce_community_quota(), public.enforce_message_quota(),
  public.enforce_channel_quota() from public;

-- ---------------------------------------------------------------------------
-- 2. CHECKs de texto
-- profiles.display_name (<= 40) y profiles.bio (<= 280) ya tienen su CHECK en
-- 0001 (profiles_display_name_len, profiles_bio_len): no se repiten aqui.
-- La lista de estilos debe coincidir con AVATAR_STYLES de lib/avatar/generator.ts
-- (hay un test que lo comprueba). Si hay filas viejas que no cumplen, corrigelas
-- antes de aplicar esta migracion.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add constraint profiles_avatar_seed_safe
    check (avatar_seed is null or (char_length(avatar_seed) between 1 and 64 and avatar_seed ~ '^[A-Za-z0-9:_.-]+$')),
  add constraint profiles_avatar_style_known
    check (avatar_style is null or avatar_style in
      ('astronaut', 'planet', 'constellation', 'rocket', 'nebula', 'portal', 'eclipse')),
  add constraint profiles_x_handle_format
    check (x_handle is null or x_handle ~ '^[A-Za-z0-9_]{1,15}$');

alter table public.communities
  add constraint communities_icon_len check (char_length(icon) <= 16);

alter table public.channels
  add constraint channels_topic_len check (topic is null or char_length(topic) <= 200);

-- ---------------------------------------------------------------------------
-- 3. Una cuenta de X = un perfil
-- Si hubiera duplicados previos, la creacion del indice falla: resuelvelos antes.
-- ---------------------------------------------------------------------------

create unique index if not exists profiles_x_handle_lower_key
  on public.profiles (lower(x_handle))
  where x_handle is not null;

-- ---------------------------------------------------------------------------
-- 4. Rol de confianza para verificar X (sin service_role)
-- El servidor firma un JWT de 2 minutos con `role: kosmovia_verifier` (misma
-- clave ES256 que las sesiones) y llama a PostgREST. Puede leer id y wallet de
-- profiles y actualizar SOLO x_handle, x_verified_at y trust_level, y nunca
-- dejar trust_level en 2. Supabase debe aceptar JWT con este rol: ver
-- supabase/README.md.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'kosmovia_verifier') then
    create role kosmovia_verifier nologin;
  end if;
end
$$;

-- PostgREST entra como `authenticator` y cambia al rol del JWT (SET ROLE): para
-- eso `authenticator` debe poder asumir este rol. En Supabase equivale a:
--   grant kosmovia_verifier to authenticator;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'grant kosmovia_verifier to authenticator';
  end if;
end
$$;

grant usage on schema public to kosmovia_verifier;

revoke all on public.profiles from kosmovia_verifier;
grant select (id, wallet) on public.profiles to kosmovia_verifier;
grant update (x_handle, x_verified_at, trust_level) on public.profiles to kosmovia_verifier;

-- La lectura (profiles_select_public, sin `TO`) ya cubre a este rol.
-- El WITH CHECK impide dejar trust_level en 2 (o mas): este rol nunca sube a "empresa".
create policy profiles_verifier_update on public.profiles
  for update to kosmovia_verifier
  using (true)
  with check (trust_level <= 1);

-- Defensa extra, sin leer columnas con permisos de SELECT: este rol no toca un
-- perfil que ya es nivel 2 (no lo baja), falla si intenta fijar un nivel mayor
-- a 1, y nunca deja el nivel por debajo de 1 (verificar X es nivel 1 como minimo).
create or replace function public.profiles_verifier_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'kosmovia_verifier' then
    if old.trust_level >= 2 then
      raise exception 'verifier_forbidden:trust_level'
        using errcode = '42501', hint = 'El verificador no modifica perfiles de nivel 2.';
    end if;
    if new.trust_level > 1 then
      raise exception 'verifier_forbidden:trust_level'
        using errcode = '42501', hint = 'El verificador nunca fija nivel 2.';
    end if;
    new.trust_level := 1;
  end if;
  return new;
end;
$$;

create trigger profiles_before_update_verifier_guard
before update on public.profiles
for each row execute function public.profiles_verifier_guard();

revoke all on function public.profiles_verifier_guard() from public;
