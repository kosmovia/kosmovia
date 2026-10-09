-- Kosmovia · ajustes del PIN de pagos tras la revisión adversarial.
--
-- payment_security:
--   pin_version        sube con cada PIN nuevo (crearlo, cambiarlo o activar un reset). Un permiso
--                      y una verificación del PIN solo valen para la versión con la que se hicieron.
--   pending_pin_*      "olvidé mi PIN": el PIN nuevo NO reemplaza al actual al instante; queda
--                      pendiente y se activa a las 24 h (pending_pin_at es la hora de activación).
--                      Mientras tanto el PIN actual sigue valiendo y puede cancelar el reset.
-- payment_approvals:
--   pin_version        la versión del PIN con la que se verificó el permiso.
-- payments:
--   un permiso respalda a lo más un pago (índice único parcial sobre approval_id).
--
-- Idempotente: se puede volver a correr sin romper nada. La 0009 no se toca.

alter table public.payment_security add column if not exists pin_version integer not null default 0;
alter table public.payment_security add column if not exists pending_pin_hash text null;
alter table public.payment_security add column if not exists pending_pin_salt text null;
alter table public.payment_security add column if not exists pending_pin_at timestamptz null;

alter table public.payment_security drop constraint if exists payment_security_pending_pin_trio;
alter table public.payment_security add constraint payment_security_pending_pin_trio
  check (
    (pending_pin_hash is null) = (pending_pin_salt is null)
    and (pending_pin_hash is null) = (pending_pin_at is null)
  );
alter table public.payment_security drop constraint if exists payment_security_pin_version_range;
alter table public.payment_security add constraint payment_security_pin_version_range
  check (pin_version >= 0);

alter table public.payment_approvals add column if not exists pin_version integer not null default 0;

create unique index if not exists payments_approval_id_key
  on public.payments (approval_id) where approval_id is not null;
