-- Kosmovia core · Etapa A · esquema para Postgres plano (modo "api").
--
-- Equivale a supabase/migrations/0001_stage_a.sql + 0002_hardening.sql, SIN lo
-- propio de Supabase: no hay auth.jwt(), RLS, roles anon/authenticated/
-- authenticator, publicacion supabase_realtime ni el rol kosmovia_verifier.
-- La autorizacion (miembro, owner/admin, autor = sesion) la hace el servidor
-- en lib/db/repo.ts y las rutas /api; las cuotas siguen siendo triggers
-- atomicos en la base.
--
-- Idempotente: se puede volver a correr sin romper nada. Pensado para una base
-- de PRUEBA (Render), no para produccion. Requiere Postgres 13+ (gen_random_uuid()).
-- Los mensajes de cuota empiezan con `quota_exceeded:` (SQLSTATE P0001).

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id            uuid primary key,  -- UUID v5 de la wallet, lo calcula el servidor
  wallet        text not null,
  username      text not null,
  display_name  text not null default '',
  avatar_seed   text,
  avatar_style  text,
  bio           text,
  trust_level   smallint not null default 0,
  x_handle      text,
  x_verified_at timestamptz,
  created_at    timestamptz not null default now(),
  constraint profiles_wallet_key unique (wallet),
  constraint profiles_trust_level_check check (trust_level in (0, 1, 2)),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_display_name_len check (char_length(display_name) <= 40),
  constraint profiles_bio_len check (bio is null or char_length(bio) <= 280),
  constraint profiles_avatar_seed_safe
    check (avatar_seed is null or (char_length(avatar_seed) between 1 and 64 and avatar_seed ~ '^[A-Za-z0-9:_.-]+$')),
  -- Debe coincidir con AVATAR_STYLES de lib/avatar/generator.ts (hay un test).
  constraint profiles_avatar_style_known
    check (avatar_style is null or avatar_style in
      ('astronaut', 'planet', 'constellation', 'rocket', 'nebula', 'portal', 'eclipse')),
  constraint profiles_x_handle_format check (x_handle is null or x_handle ~ '^[A-Za-z0-9_]{1,15}$')
);
create unique index if not exists profiles_username_lower_key on public.profiles (lower(username));
-- Una cuenta de X = un perfil.
create unique index if not exists profiles_x_handle_lower_key
  on public.profiles (lower(x_handle))
  where x_handle is not null;

create table if not exists public.communities (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null,
  name        text not null,
  icon        text not null default '',
  description text not null default '',
  owner_id    uuid not null references public.profiles (id) on delete restrict,
  created_at  timestamptz not null default now(),
  constraint communities_slug_key unique (slug),
  constraint communities_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 40),
  constraint communities_name_len check (char_length(name) between 2 and 50),
  constraint communities_description_len check (char_length(description) <= 280),
  constraint communities_icon_len check (char_length(icon) <= 16)
);
create index if not exists communities_owner_created_idx on public.communities (owner_id, created_at);

create table if not exists public.members (
  community_id uuid not null references public.communities (id) on delete cascade,
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (community_id, profile_id)
);
create index if not exists members_profile_id_idx on public.members (profile_id);

create table if not exists public.channels (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  name         text not null,
  topic        text,
  type         text not null default 'text' check (type in ('text', 'announcement')),
  created_at   timestamptz not null default now(),
  constraint channels_name_format check (name ~ '^[a-z0-9-]{1,30}$'),
  constraint channels_topic_len check (topic is null or char_length(topic) <= 200),
  constraint channels_community_name_key unique (community_id, name)
);
create index if not exists channels_community_id_idx on public.channels (community_id);

create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  content    text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists messages_channel_created_idx on public.messages (channel_id, created_at);
create index if not exists messages_author_created_idx on public.messages (author_id, created_at);

-- ---------------------------------------------------------------------------
-- Trigger: al crear una comunidad, el dueno entra como 'owner' y se crean los
-- canales "general" (text) y "anuncios" (announcement).
-- ---------------------------------------------------------------------------

create or replace function public.on_community_created()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.members (community_id, profile_id, role)
  values (new.id, new.owner_id, 'owner');

  insert into public.channels (community_id, name, topic, type) values
    (new.id, 'general', 'Conversación general', 'text'),
    (new.id, 'anuncios', 'Novedades de la comunidad', 'announcement');

  return new;
end;
$$;

drop trigger if exists communities_after_insert on public.communities;
create trigger communities_after_insert
after insert on public.communities
for each row execute function public.on_community_created();

-- ---------------------------------------------------------------------------
-- Cuotas atomicas (BEFORE INSERT). Cada funcion toma un advisory lock de
-- transaccion por usuario (o por comunidad) antes de contar: dos inserts
-- simultaneos del mismo usuario se serializan.
-- ---------------------------------------------------------------------------

-- Comunidades: maximo 3 creadas en 24 h y 10 en total por perfil.
create or replace function public.enforce_community_quota()
returns trigger
language plpgsql
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

drop trigger if exists communities_before_insert_quota on public.communities;
create trigger communities_before_insert_quota
before insert on public.communities
for each row execute function public.enforce_community_quota();

-- Mensajes: maximo 20 por minuto y 500 por hora por autor.
create or replace function public.enforce_message_quota()
returns trigger
language plpgsql
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

drop trigger if exists messages_before_insert_quota on public.messages;
create trigger messages_before_insert_quota
before insert on public.messages
for each row execute function public.enforce_message_quota();

-- Canales: maximo 50 por comunidad (incluye los 2 que crea el trigger de arriba).
create or replace function public.enforce_channel_quota()
returns trigger
language plpgsql
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

drop trigger if exists channels_before_insert_quota on public.channels;
create trigger channels_before_insert_quota
before insert on public.channels
for each row execute function public.enforce_channel_quota();
