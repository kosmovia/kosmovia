-- Kosmovia · categorías de canales, canales privados/de pagos y mensajes directos.
--
-- A) Categorías (grupos de canales al estilo Discord): channel_categories, y en
--    channels: category_id, position, visibility ('public' | 'private') y emoji.
--    El tipo 'payments' (verificacion-pagos) se suma a 'text' y 'announcement'.
--    Las comunidades que ya existen reciben las categorías "Información" y
--    "Comunidad", el canal verificacion-pagos y el canal cobros; el trigger de
--    comunidades nuevas hace lo mismo.
-- B) Mensajes directos: dm_threads (un hilo por par de perfiles) y dm_messages.
--
-- Idempotente: se puede volver a correr sin romper nada.

-- ---------------------------------------------------------------------------
-- A) Categorías de canales
-- ---------------------------------------------------------------------------

create table if not exists public.channel_categories (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  name         text not null,
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  constraint channel_categories_name_len check (char_length(name) between 1 and 40)
);
create index if not exists channel_categories_community_idx on public.channel_categories (community_id, position);

alter table public.channels add column if not exists category_id uuid null references public.channel_categories (id) on delete set null;
alter table public.channels add column if not exists position integer not null default 0;
alter table public.channels add column if not exists visibility text not null default 'public';
alter table public.channels add column if not exists emoji text null;
create index if not exists channels_category_idx on public.channels (category_id);

alter table public.channels drop constraint if exists channels_visibility_check;
alter table public.channels add constraint channels_visibility_check check (visibility in ('public', 'private'));
alter table public.channels drop constraint if exists channels_emoji_len;
alter table public.channels add constraint channels_emoji_len check (emoji is null or char_length(emoji) <= 16);

-- El CHECK de type no tiene nombre en 0001: se reemplaza el que mencione 'announcement'.
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.channels'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%announcement%'
  loop
    execute format('alter table public.channels drop constraint %I', r.conname);
  end loop;
end
$$;
alter table public.channels drop constraint if exists channels_type_check;
alter table public.channels add constraint channels_type_check check (type in ('text', 'announcement', 'payments'));

-- Máximo 20 categorías por comunidad (mismo patrón que las otras cuotas).
create or replace function public.enforce_category_quota()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('kosmovia:categories:' || new.community_id::text, 0));
  select count(*) into v_count from public.channel_categories c where c.community_id = new.community_id;
  if v_count >= 20 then
    raise exception 'quota_exceeded:categories_per_community'
      using errcode = 'P0001', hint = 'Maximo 20 categorias por comunidad.';
  end if;
  return new;
end;
$$;

drop trigger if exists channel_categories_before_insert_quota on public.channel_categories;
create trigger channel_categories_before_insert_quota
before insert on public.channel_categories
for each row execute function public.enforce_category_quota();

-- ---------------------------------------------------------------------------
-- Comunidades que ya existen: categorías, canales por defecto y emojis.
-- Si una comunidad ya está en el tope de canales (el trigger de cuota avisa con
-- P0001), se salta ese canal y se sigue con el resto.
-- ---------------------------------------------------------------------------

do $$
declare
  c        record;
  v_info   uuid;
  v_com    uuid;
begin
  for c in select id from public.communities loop
    select id into v_info from public.channel_categories where community_id = c.id and name = 'Información' order by created_at limit 1;
    if v_info is null then
      insert into public.channel_categories (community_id, name, position) values (c.id, 'Información', 0) returning id into v_info;
    end if;
    select id into v_com from public.channel_categories where community_id = c.id and name = 'Comunidad' order by created_at limit 1;
    if v_com is null then
      insert into public.channel_categories (community_id, name, position) values (c.id, 'Comunidad', 1) returning id into v_com;
    end if;

    -- anuncios -> Información (posición 0).
    update public.channels
       set category_id = v_info, position = 0, emoji = coalesce(emoji, '📢')
     where community_id = c.id and name = 'anuncios' and category_id is null;

    -- general -> Comunidad (posición 0); cualquier otro canal sin categoría -> Comunidad, en orden de creación.
    update public.channels
       set category_id = v_com, position = 0, emoji = coalesce(emoji, '💬')
     where community_id = c.id and name = 'general' and category_id is null;

    update public.channels ch
       set category_id = v_com, position = o.rn
      from (
        select x.id, row_number() over (order by x.created_at, x.id) as rn
        from public.channels x
        where x.community_id = c.id and x.category_id is null
      ) o
     where ch.id = o.id;

    begin
      insert into public.channels (community_id, name, topic, type, category_id, position, emoji)
      select c.id, 'cobros', 'Cobros en USDC: crea un cobro con [+] y págalo aquí', 'text', v_info, 1, '🧾'
      where not exists (select 1 from public.channels x where x.community_id = c.id and x.name = 'cobros');
    exception when sqlstate 'P0001' then
      null;
    end;

    begin
      insert into public.channels (community_id, name, topic, type, category_id, position, emoji)
      select c.id, 'verificacion-pagos', 'Comprobantes de pagos verificados en Stellar', 'payments', v_info, 2, '💸'
      where not exists (select 1 from public.channels x where x.community_id = c.id and x.name = 'verificacion-pagos');
    exception when sqlstate 'P0001' then
      null;
    end;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Comunidades nuevas: el dueño entra como 'owner' y se crean las categorías
-- "Información" y "Comunidad" con #anuncios, #cobros, #verificacion-pagos y #general.
-- ---------------------------------------------------------------------------

create or replace function public.on_community_created()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_info uuid;
  v_com  uuid;
begin
  insert into public.members (community_id, profile_id, role)
  values (new.id, new.owner_id, 'owner');

  insert into public.channel_categories (community_id, name, position) values (new.id, 'Información', 0) returning id into v_info;
  insert into public.channel_categories (community_id, name, position) values (new.id, 'Comunidad', 1) returning id into v_com;

  insert into public.channels (community_id, name, topic, type, category_id, position, emoji) values
    (new.id, 'anuncios', 'Novedades de la comunidad', 'announcement', v_info, 0, '📢'),
    (new.id, 'cobros', 'Cobros en USDC: crea un cobro con [+] y págalo aquí', 'text', v_info, 1, '🧾'),
    (new.id, 'verificacion-pagos', 'Comprobantes de pagos verificados en Stellar', 'payments', v_info, 2, '💸'),
    (new.id, 'general', 'Conversación general', 'text', v_com, 0, '💬');

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- B) Mensajes directos
-- ---------------------------------------------------------------------------

-- El par se guarda ordenado (user_a < user_b): un solo hilo por par y nunca consigo mismo.
create table if not exists public.dm_threads (
  id              uuid primary key default gen_random_uuid(),
  user_a          uuid not null references public.profiles (id) on delete cascade,
  user_b          uuid not null references public.profiles (id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  a_read_at       timestamptz null,
  b_read_at       timestamptz null,
  constraint dm_threads_pair_ordered check (user_a < user_b),
  constraint dm_threads_pair_key unique (user_a, user_b)
);
create index if not exists dm_threads_user_b_idx on public.dm_threads (user_b);
create index if not exists dm_threads_user_a_last_idx on public.dm_threads (user_a, last_message_at desc);

create table if not exists public.dm_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.dm_threads (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  content    text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at  timestamptz null
);
create index if not exists dm_messages_thread_created_idx on public.dm_messages (thread_id, created_at);
create index if not exists dm_messages_author_created_idx on public.dm_messages (author_id, created_at);

-- Mensajes directos: mismo tope que los de canal (20 por minuto, 500 por hora por autor).
create or replace function public.enforce_dm_message_quota()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_minute integer;
  v_hour   integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('kosmovia:dm_messages:' || new.author_id::text, 0));

  select count(*) filter (where m.created_at > now() - interval '1 minute'), count(*)
    into v_minute, v_hour
  from public.dm_messages m
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

drop trigger if exists dm_messages_before_insert_quota on public.dm_messages;
create trigger dm_messages_before_insert_quota
before insert on public.dm_messages
for each row execute function public.enforce_dm_message_quota();
