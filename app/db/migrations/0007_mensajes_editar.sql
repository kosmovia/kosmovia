-- Kosmovia · editar mensajes.
-- messages.edited_at: cuándo se editó por última vez el mensaje (null = nunca).
-- Lo escribe solo la API al editar (PATCH /api/channels/[id]/messages/[messageId]).
--
-- Idempotente: se puede volver a correr sin romper nada.

alter table public.messages add column if not exists edited_at timestamptz null;
