-- Kosmovia · mini-apps: conexiones entre una persona y una mini-app.
--
-- Cuando alguien abre una mini-app por primera vez, Kosmovia (el host) le muestra
-- qué pide la app y le pide el PIN de pagos. Si lo da, se guarda aquí una
-- "conexión": la persona autorizó a esa app a ver su perfil público, pedirle pagos
-- y/o publicar en el canal. Desconectar marca revoked_at (no se borra la fila,
-- queda el historial).
--
-- OJO, qué es y qué no es una conexión:
--   * Es el consentimiento que consulta el host. NO mueve dinero ni reemplaza al
--     PIN: cada pago que pida la app sigue necesitando su permiso con PIN.
--   * permissions se guarda desde el catálogo del SERVIDOR (lib/core/miniapps.ts),
--     nunca desde lo que mande el cliente.
--   * pin_version es la versión del PIN con la que se autorizó. Es solo de
--     auditoría: un cambio de PIN NO revoca conexiones (solo invalida los permisos
--     de pago pendientes, como siempre).
--
-- Idempotente: se puede volver a correr sin romper nada.

create table if not exists public.miniapp_connections (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  app_id      text not null,
  permissions text[] not null default '{}',
  pin_version integer not null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz null
);

alter table public.miniapp_connections drop constraint if exists miniapp_connections_app_id_format;
alter table public.miniapp_connections add constraint miniapp_connections_app_id_format
  check (app_id ~ '^[a-z][a-z0-9-]{1,31}$');

alter table public.miniapp_connections drop constraint if exists miniapp_connections_permissions_known;
alter table public.miniapp_connections add constraint miniapp_connections_permissions_known
  check (permissions <@ array['perfil', 'pagos', 'mensajes']::text[]);

-- Una conexión activa por persona y app (las revocadas se acumulan como historial).
create unique index if not exists miniapp_connections_active_key
  on public.miniapp_connections (profile_id, app_id) where revoked_at is null;

create index if not exists miniapp_connections_profile_idx
  on public.miniapp_connections (profile_id, created_at desc);
