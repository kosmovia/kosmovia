-- Kosmovia · segunda tanda de ajustes del PIN de pagos (revisión adversarial 2).
--
-- payment_approvals:
--   memo        la referencia (memo de texto de Stellar) que el SERVIDOR genera al aprobar y que
--               el pago tiene que llevar. Al registrar el pago, el permiso solo cuenta si el memo
--               del pago en Horizon es este: así el permiso queda atado a un pago concreto y un
--               pago hecho antes del PIN no puede verificarse después.
--   revoked_at  cuándo un cambio o reset del PIN invalidó el permiso. Se fija UNA sola vez
--               (nunca se mueve en cambios posteriores). El permiso solo respalda pagos que
--               cerraron antes de esa hora.
--
-- Los permisos anteriores (sin memo) ya no pueden verificar pagos: quedan como lo que eran,
-- permisos de un PIN que ya pasó, y cuentan igual para el límite diario.
--
-- Idempotente: se puede volver a correr sin romper nada. Las migraciones anteriores no se tocan.

alter table public.payment_approvals add column if not exists memo text null;
alter table public.payment_approvals add column if not exists revoked_at timestamptz null;

alter table public.payment_approvals drop constraint if exists payment_approvals_memo_format;
alter table public.payment_approvals add constraint payment_approvals_memo_format
  check (memo is null or memo ~ '^kv-[a-z2-7]{16}$');

-- Un memo identifica un solo permiso.
create unique index if not exists payment_approvals_memo_key
  on public.payment_approvals (memo) where memo is not null;
