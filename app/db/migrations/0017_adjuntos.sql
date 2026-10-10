-- Kosmovia · archivos adjuntos en mensajes (canales y mensajes directos).
--
-- attachments: una fila por archivo subido. Hoy los bytes viven en esta misma tabla
--   (columnas `data` y `thumb`, bytea) detrás de la interfaz AttachmentStore
--   (lib/core/attachments-store.ts): cuando convenga pasar a Supabase Storage o R2
--   solo cambia esa interfaz (la fila queda aquí; los bytes se mueven).
--   - scope 'channel' (channel_id) o 'dm' (dm_thread_id): exactamente uno de los dos.
--   - kind 'image' (siempre re-codificada por el servidor: sin EXIF, <= 2048 px) o 'pdf'.
--   - message_id: se llena cuando el mensaje que lleva el marcador [ARCHIVO:<id>] se publica.
--     No tiene llave foránea porque apunta a messages o a dm_messages según el scope;
--     unos triggers borran los adjuntos cuando se borra su mensaje.
--     Un archivo sin message_id solo lo ve quien lo subió (la bandeja antes de enviar).
--
-- Cuotas (triggers, SQLSTATE P0001 `quota_exceeded:*`):
--   - 30 subidas por hora por perfil.
--   - 100 MB en total por perfil (archivos y miniaturas).
--   Antes de contar se borran los archivos del perfil que nunca se enviaron y tienen más de 1 día.
--
-- Idempotente: se puede volver a correr sin romper nada.

create table if not exists public.attachments (
  id            uuid primary key default gen_random_uuid(),
  uploader_id   uuid not null references public.profiles (id) on delete cascade,
  scope         text not null,
  channel_id    uuid null references public.channels (id) on delete cascade,
  dm_thread_id  uuid null references public.dm_threads (id) on delete cascade,
  kind          text not null,
  mime          text not null,
  name          text not null,
  size          integer not null,
  width         integer null,
  height        integer null,
  data          bytea not null,
  thumb         bytea null,
  created_at    timestamptz not null default now(),
  message_id    uuid null
);

alter table public.attachments drop constraint if exists attachments_scope_check;
alter table public.attachments add constraint attachments_scope_check check (scope in ('channel', 'dm'));

-- Exactamente un destino, el que dice el scope.
alter table public.attachments drop constraint if exists attachments_target_check;
alter table public.attachments add constraint attachments_target_check check (
  (scope = 'channel' and channel_id is not null and dm_thread_id is null)
  or (scope = 'dm' and dm_thread_id is not null and channel_id is null)
);

alter table public.attachments drop constraint if exists attachments_kind_check;
alter table public.attachments add constraint attachments_kind_check check (
  (kind = 'image' and mime in ('image/webp', 'image/jpeg') and width is not null and height is not null)
  or (kind = 'pdf' and mime = 'application/pdf' and thumb is null)
);

alter table public.attachments drop constraint if exists attachments_name_len;
alter table public.attachments add constraint attachments_name_len check (char_length(name) between 1 and 120);

-- 5 MB por archivo; `size` es el largo real de `data`.
alter table public.attachments drop constraint if exists attachments_size_check;
alter table public.attachments add constraint attachments_size_check check (
  size between 1 and 5242880 and octet_length(data) = size
);

alter table public.attachments drop constraint if exists attachments_dims_check;
alter table public.attachments add constraint attachments_dims_check check (
  (width is null or width between 1 and 4096) and (height is null or height between 1 and 4096)
);

alter table public.attachments drop constraint if exists attachments_thumb_size;
alter table public.attachments add constraint attachments_thumb_size check (thumb is null or octet_length(thumb) <= 524288);

create index if not exists attachments_uploader_created_idx on public.attachments (uploader_id, created_at);
create index if not exists attachments_message_idx on public.attachments (message_id) where message_id is not null;
create index if not exists attachments_channel_idx on public.attachments (channel_id) where channel_id is not null;
create index if not exists attachments_dm_thread_idx on public.attachments (dm_thread_id) where dm_thread_id is not null;

-- Cuotas de subida. Un candado por perfil evita que dos subidas a la vez se pasen del tope.
create or replace function public.enforce_attachment_quota()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_hour  integer;
  v_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('kosmovia:attachments:' || new.uploader_id::text, 0));

  -- Lo que se subió y nunca se envió (se quitó de la bandeja, o se cerró la pestaña) se limpia solo.
  delete from public.attachments a
   where a.uploader_id = new.uploader_id
     and a.message_id is null
     and a.created_at < now() - interval '1 day';

  select count(*) into v_hour
    from public.attachments a
   where a.uploader_id = new.uploader_id
     and a.created_at > now() - interval '1 hour';
  if v_hour >= 30 then
    raise exception 'quota_exceeded:attachments_per_hour'
      using errcode = 'P0001', hint = 'Maximo 30 archivos por hora.';
  end if;

  select coalesce(sum(a.size + coalesce(octet_length(a.thumb), 0)), 0) into v_bytes
    from public.attachments a
   where a.uploader_id = new.uploader_id;
  if v_bytes + new.size + coalesce(octet_length(new.thumb), 0) > 104857600 then
    raise exception 'quota_exceeded:attachments_total_bytes'
      using errcode = 'P0001', hint = 'Maximo 100 MB de archivos por perfil.';
  end if;

  return new;
end;
$$;

drop trigger if exists attachments_before_insert_quota on public.attachments;
create trigger attachments_before_insert_quota
before insert on public.attachments
for each row execute function public.enforce_attachment_quota();

-- Al borrar un mensaje (de canal o directo) se borran sus archivos.
create or replace function public.delete_message_attachments()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.attachments a where a.message_id = old.id;
  return old;
end;
$$;

drop trigger if exists messages_after_delete_attachments on public.messages;
create trigger messages_after_delete_attachments
after delete on public.messages
for each row execute function public.delete_message_attachments();

drop trigger if exists dm_messages_after_delete_attachments on public.dm_messages;
create trigger dm_messages_after_delete_attachments
after delete on public.dm_messages
for each row execute function public.delete_message_attachments();
