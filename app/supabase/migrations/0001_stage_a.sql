-- Kosmovia core · Etapa A · tablas, RLS, trigger de comunidad y Realtime.
-- Ver core/docs/ARQUITECTURA.md secciones 2 y 3.
--
-- La identidad viene del JWT que firma nuestro servidor (POST /api/auth/session):
--   sub    = UUID v5 derivado de la wallet (= profiles.id)
--   wallet = direccion Stellar
-- No se usa Supabase Auth ni la service_role.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table public.profiles (
  id            uuid primary key,  -- UUID v5 de la wallet, lo calcula el servidor
  wallet        text not null unique,
  username      text not null,
  display_name  text not null default '',
  avatar_seed   text,
  avatar_style  text,
  bio           text,
  trust_level   smallint not null default 0 check (trust_level in (0, 1, 2)),
  x_handle      text,
  x_verified_at timestamptz,
  created_at    timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_display_name_len check (char_length(display_name) <= 40),
  constraint profiles_bio_len check (bio is null or char_length(bio) <= 280)
);
create unique index profiles_username_lower_key on public.profiles (lower(username));

create table public.communities (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  icon        text not null default '',
  description text not null default '',
  owner_id    uuid not null references public.profiles (id) on delete restrict,
  created_at  timestamptz not null default now(),
  constraint communities_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 40),
  constraint communities_name_len check (char_length(name) between 2 and 50),
  constraint communities_description_len check (char_length(description) <= 280)
);

create table public.members (
  community_id uuid not null references public.communities (id) on delete cascade,
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (community_id, profile_id)
);
create index members_profile_id_idx on public.members (profile_id);

create table public.channels (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  name         text not null,
  topic        text,
  type         text not null default 'text' check (type in ('text', 'announcement')),
  created_at   timestamptz not null default now(),
  constraint channels_name_format check (name ~ '^[a-z0-9-]{1,30}$'),
  unique (community_id, name)
);
create index channels_community_id_idx on public.channels (community_id);

create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  content    text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index messages_channel_created_idx on public.messages (channel_id, created_at);

-- ---------------------------------------------------------------------------
-- Funciones auxiliares
-- SECURITY DEFINER para que las politicas puedan consultar `members` sin
-- entrar en recursion con su propia RLS.
-- ---------------------------------------------------------------------------

create or replace function public.current_profile_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create or replace function public.member_role(p_community uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.members m
  where m.community_id = p_community
    and m.profile_id = public.current_profile_id()
$$;

create or replace function public.is_member(p_community uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.member_role(p_community) is not null
$$;

create or replace function public.channel_community(p_channel uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.community_id from public.channels c where c.id = p_channel
$$;

-- true si el usuario actual puede escribir en el canal:
-- 'text' = cualquier miembro; 'announcement' = solo owner/admin.
create or replace function public.can_post(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.channels ch
    join public.members m
      on m.community_id = ch.community_id
     and m.profile_id = public.current_profile_id()
    where ch.id = p_channel
      and (ch.type = 'text' or m.role in ('owner', 'admin'))
  )
$$;

revoke all on function public.current_profile_id(), public.member_role(uuid), public.is_member(uuid),
  public.channel_community(uuid), public.can_post(uuid) from public;
grant execute on function public.current_profile_id(), public.member_role(uuid), public.is_member(uuid),
  public.channel_community(uuid), public.can_post(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Trigger: al crear una comunidad, el dueno entra como 'owner' y se crean los
-- canales "general" (text) y "anuncios" (announcement).
-- ---------------------------------------------------------------------------

create or replace function public.on_community_created()
returns trigger
language plpgsql
security definer
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

create trigger communities_after_insert
after insert on public.communities
for each row execute function public.on_community_created();

-- ---------------------------------------------------------------------------
-- Permisos de tabla (RLS decide fila por fila; esto limita columnas)
-- ---------------------------------------------------------------------------

revoke all on public.profiles, public.communities, public.members, public.channels, public.messages
  from anon, authenticated;

grant select on public.profiles, public.communities to anon, authenticated;
grant select on public.members, public.channels, public.messages to authenticated;

-- Perfil: el usuario no puede tocar trust_level, x_handle ni x_verified_at
-- (los fija la verificacion del servidor).
grant insert (id, wallet, username, display_name, avatar_seed, avatar_style, bio)
  on public.profiles to authenticated;
grant update (username, display_name, avatar_seed, avatar_style, bio)
  on public.profiles to authenticated;

grant insert (name, slug, icon, description, owner_id) on public.communities to authenticated;
grant update (name, icon, description) on public.communities to authenticated;

grant insert (community_id, profile_id, role) on public.members to authenticated;
grant update (role) on public.members to authenticated;
grant delete on public.members to authenticated;

grant insert (community_id, name, topic, type) on public.channels to authenticated;
grant update (name, topic) on public.channels to authenticated;

grant insert (channel_id, author_id, content) on public.messages to authenticated;
grant delete on public.messages to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles    enable row level security;
alter table public.communities enable row level security;
alter table public.members     enable row level security;
alter table public.channels    enable row level security;
alter table public.messages    enable row level security;

-- profiles: lectura publica; cada quien crea y edita solo el suyo.
create policy profiles_select_public on public.profiles
  for select using (true);

create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (
    id = public.current_profile_id()
    and wallet = (auth.jwt() ->> 'wallet')
    and trust_level = 0
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = public.current_profile_id())
  with check (id = public.current_profile_id());

-- communities: las ve cualquiera (Explorar); crea un usuario autenticado como dueno.
create policy communities_select_public on public.communities
  for select using (true);

create policy communities_insert_owner on public.communities
  for insert to authenticated
  with check (owner_id = public.current_profile_id());

create policy communities_update_admin on public.communities
  for update to authenticated
  using (public.member_role(id) in ('owner', 'admin'))
  with check (public.member_role(id) in ('owner', 'admin'));

-- members: ve las filas de sus comunidades (y las propias); se une como 'member';
-- solo owner/admin cambian roles (nunca el del owner ni a 'owner'); cada quien puede salir.
create policy members_select on public.members
  for select to authenticated
  using (profile_id = public.current_profile_id() or public.is_member(community_id));

create policy members_insert_self on public.members
  for insert to authenticated
  with check (profile_id = public.current_profile_id() and role = 'member');

create policy members_update_role on public.members
  for update to authenticated
  using (public.member_role(community_id) in ('owner', 'admin') and role <> 'owner')
  with check (public.member_role(community_id) in ('owner', 'admin') and role in ('admin', 'member'));

create policy members_delete_self on public.members
  for delete to authenticated
  using (profile_id = public.current_profile_id() and role <> 'owner');

-- channels: los ven los miembros; crean y editan owner/admin.
create policy channels_select_member on public.channels
  for select to authenticated
  using (public.is_member(community_id));

create policy channels_insert_admin on public.channels
  for insert to authenticated
  with check (public.member_role(community_id) in ('owner', 'admin'));

create policy channels_update_admin on public.channels
  for update to authenticated
  using (public.member_role(community_id) in ('owner', 'admin'))
  with check (public.member_role(community_id) in ('owner', 'admin'));

-- messages: los leen los miembros; escribe un miembro como si mismo (en canales
-- 'announcement' solo owner/admin); no hay UPDATE; el autor puede borrar el suyo.
create policy messages_select_member on public.messages
  for select to authenticated
  using (public.is_member(public.channel_community(channel_id)));

create policy messages_insert_member on public.messages
  for insert to authenticated
  with check (author_id = public.current_profile_id() and public.can_post(channel_id));

create policy messages_delete_own on public.messages
  for delete to authenticated
  using (author_id = public.current_profile_id());

-- ---------------------------------------------------------------------------
-- Realtime: nuevos mensajes (Realtime respeta las politicas SELECT de arriba)
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.messages;
