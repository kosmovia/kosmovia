-- Kosmovia · PIN de pagos.
--
-- Antes de pagar, la app le pide al servidor un "permiso" (payment_approvals):
-- el servidor verifica el PIN de 6 dígitos, el bloqueo por intentos fallidos y
-- el límite diario, y entrega un permiso de un solo uso, atado a destino, activo
-- y monto, que vence en 2 minutos. Al registrar el pago (POST /api/payments) el
-- servidor consume el permiso; un pago sin permiso válido igual se guarda (el
-- dinero ya se movió), pero queda marcado como `unverified`.
--
-- payment_security: el PIN de cada perfil (solo el hash con sal; el "pepper" vive
-- en el servidor), los intentos fallidos, el bloqueo progresivo y los límites.
-- payment_approvals: los permisos. payments: approval_id y unverified.
--
-- Idempotente: se puede volver a correr sin romper nada.

-- ---------------------------------------------------------------------------
-- payment_security
-- ---------------------------------------------------------------------------

create table if not exists public.payment_security (
  profile_id       uuid primary key references public.profiles (id) on delete cascade,
  pin_hash         text null,
  pin_salt         text null,
  pin_set_at       timestamptz null,
  failed_attempts  integer not null default 0,
  lock_level       integer not null default 0,
  locked_until     timestamptz null,
  daily_limit_usdc numeric(20, 7) not null default 100,
  daily_limit_xlm  numeric(20, 7) not null default 1000,
  updated_at       timestamptz not null default now()
);

alter table public.payment_security drop constraint if exists payment_security_pin_pair;
alter table public.payment_security add constraint payment_security_pin_pair
  check ((pin_hash is null) = (pin_salt is null));
alter table public.payment_security drop constraint if exists payment_security_attempts_range;
alter table public.payment_security add constraint payment_security_attempts_range
  check (failed_attempts between 0 and 10);
alter table public.payment_security drop constraint if exists payment_security_lock_level_range;
alter table public.payment_security add constraint payment_security_lock_level_range
  check (lock_level between 0 and 30);
alter table public.payment_security drop constraint if exists payment_security_limit_usdc_range;
alter table public.payment_security add constraint payment_security_limit_usdc_range
  check (daily_limit_usdc > 0 and daily_limit_usdc <= 100000);
alter table public.payment_security drop constraint if exists payment_security_limit_xlm_range;
alter table public.payment_security add constraint payment_security_limit_xlm_range
  check (daily_limit_xlm > 0 and daily_limit_xlm <= 100000);

-- ---------------------------------------------------------------------------
-- payment_approvals
-- ---------------------------------------------------------------------------

create table if not exists public.payment_approvals (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  to_wallet  text not null,
  asset      text not null,
  amount     numeric(20, 7) not null,
  method     text not null default 'pin',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz null,
  payment_id uuid null references public.payments (id) on delete set null
);

alter table public.payment_approvals drop constraint if exists payment_approvals_wallet_format;
alter table public.payment_approvals add constraint payment_approvals_wallet_format
  check (to_wallet ~ '^G[A-Z2-7]{55}$');
alter table public.payment_approvals drop constraint if exists payment_approvals_asset_check;
alter table public.payment_approvals add constraint payment_approvals_asset_check
  check (asset in ('USDC', 'XLM'));
alter table public.payment_approvals drop constraint if exists payment_approvals_amount_positive;
alter table public.payment_approvals add constraint payment_approvals_amount_positive
  check (amount > 0);
alter table public.payment_approvals drop constraint if exists payment_approvals_method_check;
alter table public.payment_approvals add constraint payment_approvals_method_check
  check (method in ('pin', 'passkey'));

create index if not exists payment_approvals_profile_created_idx
  on public.payment_approvals (profile_id, created_at desc);

-- ---------------------------------------------------------------------------
-- payments: qué permiso respalda el pago y si salió sin permiso
-- ---------------------------------------------------------------------------

alter table public.payments add column if not exists approval_id uuid null references public.payment_approvals (id) on delete set null;
alter table public.payments add column if not exists unverified boolean not null default false;

alter table public.payments drop constraint if exists payments_unverified_no_approval;
alter table public.payments add constraint payments_unverified_no_approval
  check (not (unverified and approval_id is not null));
