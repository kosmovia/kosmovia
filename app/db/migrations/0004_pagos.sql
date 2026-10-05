-- Kosmovia · etapa C: pagos entre usuarios (testnet).
-- Un pago se guarda solo después de que el servidor lo comprobó en Horizon:
-- salió de la wallet de la sesión, es un pago de XLM o USDC y fue exitoso.
-- Cada operación de pago de la red se guarda una sola vez (op_id único), así
-- el mismo pago no se puede registrar dos veces, ni con el hash externo ni con
-- el interno de un fee bump.

create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  op_id         text not null,
  tx_hash       text not null,
  from_wallet   text not null,
  to_wallet     text not null,
  asset         text not null,
  amount        numeric(20, 7) not null,
  note          text,
  registered_by uuid not null references public.profiles (id) on delete cascade,
  paid_at       timestamptz not null,
  created_at    timestamptz not null default now(),
  constraint payments_op_id_key unique (op_id),
  constraint payments_op_id_format check (op_id ~ '^[0-9]{1,20}$'),
  constraint payments_tx_hash_format check (tx_hash ~ '^[0-9a-f]{64}$'),
  constraint payments_wallets_format check (from_wallet ~ '^G[A-Z2-7]{55}$' and to_wallet ~ '^G[A-Z2-7]{55}$'),
  constraint payments_not_self check (from_wallet <> to_wallet),
  constraint payments_asset check (asset in ('XLM', 'USDC')),
  constraint payments_amount_positive check (amount > 0),
  constraint payments_note_length check (note is null or char_length(note) between 1 and 140)
);

create index if not exists payments_from_wallet_idx on public.payments (from_wallet, paid_at desc);
create index if not exists payments_to_wallet_idx on public.payments (to_wallet, paid_at desc);
