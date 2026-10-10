-- Kosmovia · notificaciones push (app instalable).
--
-- push_subscriptions: una fila por dispositivo/navegador (el `endpoint` lo da el servicio
--   de push del navegador y es único). Si el mismo endpoint lo registra otro perfil
--   (se cerró sesión y entró otra persona), la fila pasa a ese perfil.
-- notification_prefs: qué avisos quiere cada perfil. Sin fila = todo activado.
--
-- Idempotente: se puede volver a correr sin romper nada.

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  endpoint     text not null,
  p256dh       text not null,
  auth         text not null,
  user_agent   text null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_key;
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_key unique (endpoint);
alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_len;
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_len
  check (char_length(endpoint) between 20 and 1000);
alter table public.push_subscriptions drop constraint if exists push_subscriptions_keys_len;
alter table public.push_subscriptions add constraint push_subscriptions_keys_len
  check (char_length(p256dh) between 1 and 200 and char_length(auth) between 1 and 100);
alter table public.push_subscriptions drop constraint if exists push_subscriptions_user_agent_len;
alter table public.push_subscriptions add constraint push_subscriptions_user_agent_len
  check (user_agent is null or char_length(user_agent) <= 200);

create index if not exists push_subscriptions_profile_idx
  on public.push_subscriptions (profile_id);

create table if not exists public.notification_prefs (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  payments   boolean not null default true,
  dms        boolean not null default true,
  mentions   boolean not null default true
);
