import { HORIZON_URL, USDC_CODE, USDC_ISSUER_TESTNET } from "./pollar-config.ts";

/**
 * Payments between Kosmovia users (stage C, testnet only). Pure helpers shared
 * by the client (validation before sending) and the server (checking on
 * Horizon that a payment really happened before it is recorded). Amounts are
 * decimal strings with up to 7 places and are compared as integer stroops
 * (BigInt): no float ever touches an amount.
 */

export type PaymentAsset = "XLM" | "USDC";
export const PAYMENT_ASSETS: readonly PaymentAsset[] = ["USDC", "XLM"];

/** Smallest payment: 0.01 of either asset (sub-cent sends are noise, and 0.01 USDC is the demo amount). */
export const MIN_PAYMENT = "0.01";

/** Per-payment cap while we are on testnet: big enough to demo, small enough to catch typos. */
export const MAX_PAYMENT: Record<PaymentAsset, string> = { XLM: "10000", USDC: "10000" };

export const NOTE_MAX = 140;
/** A payment older than this can't be recorded: only fresh sends from the app. */
export const PAYMENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const TX_HASH_RE = /^[0-9a-f]{64}$/;
export const ADDRESS_RE = /^G[A-Z2-7]{55}$/;
const AMOUNT_RE = /^(\d{1,12})(?:\.(\d{1,7}))?$/;

const STROOPS = BigInt(10_000_000);
const ZERO = BigInt(0);

/** "1.5" -> 15000000 stroops. Null when it isn't a plain decimal with up to 7 places. */
export function toStroops(value: string): bigint | null {
  const match = AMOUNT_RE.exec(value);
  if (!match) return null;
  const [, whole, frac = ""] = match;
  return BigInt(whole) * STROOPS + BigInt(frac.padEnd(7, "0"));
}

/** 15000000 stroops -> "1.5000000" (Horizon's format). */
export function fromStroops(stroops: bigint): string {
  const whole = stroops / STROOPS;
  const frac = (stroops % STROOPS).toString().padStart(7, "0");
  return `${whole}.${frac}`;
}

export type AmountCheck = { ok: true; amount: string } | { ok: false; error: string };

/**
 * What the user typed -> the amount to send. Accepts a comma as the decimal
 * separator ("2,5"). Checks > 0, the per-payment cap and, when known, the
 * balance. Returns the amount normalized to 7 places.
 */
export function checkAmount(input: string, asset: PaymentAsset, balance?: string | null): AmountCheck {
  const raw = input.trim().replace(",", ".");
  if (raw === "") return { ok: false, error: "Escribe un monto." };
  const stroops = toStroops(raw);
  if (stroops === null) return { ok: false, error: "Usa solo números, con hasta 7 decimales." };
  if (stroops <= ZERO) return { ok: false, error: "El monto tiene que ser mayor que 0." };
  if (stroops < (toStroops(MIN_PAYMENT) as bigint)) return { ok: false, error: `El mínimo por envío es 0,01 ${asset}.` };
  const max = toStroops(MAX_PAYMENT[asset]) as bigint;
  if (stroops > max) return { ok: false, error: `En la red de prueba el máximo por envío es ${MAX_PAYMENT[asset]} ${asset}.` };
  if (balance != null) {
    const have = toStroops(balance);
    if (have !== null && stroops > have) return { ok: false, error: `No te alcanza: tienes ${trimAmount(balance)} ${asset}.` };
  }
  return { ok: true, amount: fromStroops(stroops) };
}

/** "5.0000000" -> "5", "0.2500000" -> "0.25". */
export function trimAmount(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

/** The private note: trimmed, no control characters, capped. Empty -> null. */
export function cleanNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const note = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, NOTE_MAX);
  return note === "" ? null : note;
}

/** The asset in the shape Pollar's sendPayment expects. */
export function pollarAsset(asset: PaymentAsset) {
  return asset === "XLM"
    ? ({ type: "native" } as const)
    : ({ type: "credit_alphanum4", code: USDC_CODE, issuer: USDC_ISSUER_TESTNET } as const);
}

// ------------------------------------------------------- Horizon verification

/** The fields of a Horizon payment operation we read. */
export interface HorizonOperation {
  id: string;
  type: string;
  transaction_successful?: boolean;
  transaction_hash: string;
  created_at: string;
  from?: string;
  to?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  amount?: string;
  /** Viene con `join=transactions`: el memo de la transacción. */
  transaction?: { memo_type?: string; memo?: string };
}

export interface VerifiedPayment {
  opId: string;
  txHash: string;
  from: string;
  to: string;
  asset: PaymentAsset;
  amount: string;
  createdAt: string;
  /** El memo de texto de la transacción (la referencia del pago); null si no lleva uno de texto. */
  memo: string | null;
}

export type Verification =
  | { ok: true; payment: VerifiedPayment }
  | { ok: false; status: number; code: string; error: string };

function assetOf(op: HorizonOperation): PaymentAsset | null {
  if (op.asset_type === "native") return "XLM";
  if (op.asset_code === USDC_CODE && op.asset_issuer === USDC_ISSUER_TESTNET) return "USDC";
  return null;
}

/**
 * Picks the one payment of `wallet` out of a transaction's operations. The
 * sender is the operation's `from` as Horizon reports it, so a payment someone
 * else made can't be claimed. Exactly one XLM/USDC payment is required.
 */
export function pickPayment(ops: HorizonOperation[], wallet: string, now = Date.now()): Verification {
  const payments = ops.filter((op) => op.type === "payment");
  if (payments.length === 0) return { ok: false, status: 422, code: "not_a_payment", error: "Esa transacción no es un pago." };
  if (payments.some((op) => op.transaction_successful === false)) {
    return { ok: false, status: 422, code: "tx_failed", error: "Ese pago falló en la red." };
  }
  const mine = payments.filter((op) => op.from === wallet);
  if (mine.length === 0) return { ok: false, status: 403, code: "not_your_payment", error: "Ese pago no salió de tu wallet." };
  if (mine.length > 1) return { ok: false, status: 422, code: "many_payments", error: "Solo se registran envíos de un pago." };
  const op = mine[0];
  const asset = assetOf(op);
  if (!asset) return { ok: false, status: 422, code: "asset_not_supported", error: "Solo se registran pagos en XLM o USDC." };
  const stroops = op.amount ? toStroops(op.amount) : null;
  if (!op.to || !ADDRESS_RE.test(op.to) || stroops === null || stroops <= ZERO) {
    return { ok: false, status: 422, code: "bad_payment", error: "No pudimos leer ese pago." };
  }
  if (op.to === wallet) return { ok: false, status: 422, code: "self_payment", error: "No se registran pagos a ti mismo." };
  const at = Date.parse(op.created_at);
  if (!Number.isFinite(at) || now - at > PAYMENT_MAX_AGE_MS) {
    return { ok: false, status: 422, code: "too_old", error: "Ese pago es de hace más de 24 horas." };
  }
  if (!TX_HASH_RE.test(op.transaction_hash) || !/^\d{1,20}$/.test(op.id)) {
    return { ok: false, status: 422, code: "bad_payment", error: "No pudimos leer ese pago." };
  }
  return {
    ok: true,
    payment: {
      opId: op.id,
      txHash: op.transaction_hash,
      from: wallet,
      to: op.to,
      asset,
      amount: fromStroops(stroops),
      createdAt: new Date(at).toISOString(),
      memo: op.transaction?.memo_type === "text" && typeof op.transaction.memo === "string" ? op.transaction.memo.trim() : null,
    },
  };
}

export type HorizonLookup =
  | { found: true; ops: HorizonOperation[] }
  | { found: false }
  | { error: string };

/**
 * The operations of a transaction on Horizon testnet. A 404 means it isn't
 * ingested yet (or doesn't exist): the client retries for a few seconds.
 */
export async function fetchTxOperations(
  hash: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HorizonLookup> {
  try {
    const res = await fetchImpl(`${HORIZON_URL}/transactions/${hash}/operations?limit=20&join=transactions`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 404) return { found: false };
    if (!res.ok) return { error: `horizon_${res.status}` };
    const body = (await res.json()) as { _embedded?: { records?: HorizonOperation[] } };
    return { found: true, ops: body._embedded?.records ?? [] };
  } catch {
    return { error: "horizon_unreachable" };
  }
}

export function explorerTxUrl(hash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

// ------------------------------------------- sending without paying twice
//
// Ported from Pollar Pass (pollar-apps/apps/event-tickets), where it was
// tested with real payments and two adversarial reviews. Every send carries a
// unique memo and a bounded lifetime, and the browser remembers it BEFORE the
// SDK is called. An error with no hash is "unknown", never "not sent": the
// app then looks the payment up by its memo and only lets the person send
// again once the network could no longer accept that transaction.

/** The transaction's lifetime (`timeoutSec`): signed after this, Stellar refuses it. */
export const SEND_TIMEOUT_SEC = 5 * 60;
/** Clock drift and a ledger closing just after the bound. */
export const ATTEMPT_SLACK_MS = 2 * 60 * 1000;

/** "kv-" + 16 base32 characters: unique per send, public on-chain, carries nothing personal. */
export const MEMO_RE = /^kv-[a-z2-7]{16}$/;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

export function newPaymentRef(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(16));
  return `kv-${Array.from(bytes, (b) => BASE32[b & 31]).join("")}`;
}

/** Si al permiso del PIN le queda menos que esto, no se firma: se pide confirmar de nuevo. */
export const MIN_APPROVAL_LEFT_MS = 30 * 1000;

/**
 * Vida de la transacción cuando la paga un permiso del PIN: la normal, pero nunca
 * más de lo que le queda al permiso. Así la red no puede aceptar el pago después de
 * que el permiso venció. Con menos de MIN_APPROVAL_LEFT_MS no se firma.
 */
export function approvalTimeoutSec(
  approvalExpiresAtMs: number,
  nowMs: number,
  maxSec = SEND_TIMEOUT_SEC,
): { ok: true; timeoutSec: number } | { ok: false } {
  const left = approvalExpiresAtMs - nowMs;
  if (!Number.isFinite(left) || left < MIN_APPROVAL_LEFT_MS) return { ok: false };
  return { ok: true, timeoutSec: Math.min(maxSec, Math.floor(left / 1000)) };
}

/** The options of `sendPayment`: the memo that finds this payment again and its lifetime. */
export function paymentOptions(memo: string, timeoutSec = SEND_TIMEOUT_SEC) {
  return { memo: { type: "text" as const, value: memo }, timeoutSec };
}

/** After this instant the attempt started at `startedAtMs` can no longer land. */
export function attemptDeadlineMs(startedAtMs: number): number {
  return startedAtMs + SEND_TIMEOUT_SEC * 1000 + ATTEMPT_SLACK_MS;
}

type OutcomeLike = { status?: string; hash?: string; code?: string; details?: string; message?: string };

/** Why a send provably never left. */
export type RejectionReason = "noWallet" | "notReady" | "signFailed" | "declined" | "balance" | "fee" | "destination" | "other";

/**
 * Backend codes that refuse a request before anything is submitted. An
 * allowlist on purpose: TX_BAD_SEQUENCE and TX_CONTRACT_FAILED can follow a
 * submission, so they stay "unknown".
 */
const REJECTED_CODES: Record<string, RejectionReason> = {
  TX_INSUFFICIENT_BALANCE: "balance",
  TX_INSUFFICIENT_FEE: "fee",
  TX_FEE_LIMIT_EXCEEDED: "fee",
  TX_DESTINATION_NOT_FOUND: "destination",
  TX_NO_TRUSTLINE: "destination",
  // 409 of /tx/build-sign-submit: Pollar never finished provisioning the custodial
  // wallet, so it refuses to build or sign anything (it retries on the next sign-in).
  SDK_WALLET_NOT_READY: "notReady",
  // 403 of /tx/build-sign-submit: Pollar refused to sign (e.g. the asset is not
  // enabled for the app). Without a signature nothing can be submitted.
  TX_SIGN_FAILED: "signFailed",
};

/** Messages the SDK raises on the client before sending, compared whole. */
const SDK_BEFORE_SUBMIT = new Set(
  [
    "No wallet connected",
    "Wallet not connected. Reconnect your wallet to sign.",
    "missing unsigned transaction",
    "build returned no unsigned transaction",
    "no prepared smart transaction; call buildTx first",
  ].map((m) => m.toLowerCase()),
);

/** A person declining in Freighter or another wallet, as the adapter words it. */
const WALLET_DECLINED = /^(the )?user (declined|rejected|denied|refused|cancell?ed|closed)\b[^.\n]{0,60}\.?$/i;

export function rejectionReason(outcome: OutcomeLike | null | undefined): RejectionReason | null {
  if (!outcome || outcome.hash || outcome.status !== "error") return null;
  if (outcome.code && Object.prototype.hasOwnProperty.call(REJECTED_CODES, outcome.code)) return REJECTED_CODES[outcome.code];
  const details = (outcome.details ?? "").trim();
  if (details) {
    const lower = details.toLowerCase();
    if (SDK_BEFORE_SUBMIT.has(lower)) return lower.includes("wallet") ? "noWallet" : "other";
    if (WALLET_DECLINED.test(details)) return "declined";
  }
  return null;
}

/**
 * - `sent`: it has a hash, the network saw it (Horizon says whether it succeeded).
 * - `rejected`: it provably never left.
 * - `unknown`: anything else. It may have gone through: look for it, never resend.
 */
export function classifySubmit(outcome: OutcomeLike | null | undefined): "sent" | "rejected" | "unknown" {
  if (!outcome) return "unknown";
  if (outcome.hash) return "sent";
  if (outcome.status !== "error") return "unknown";
  return rejectionReason(outcome) === null ? "unknown" : "rejected";
}

/**
 * The SDK's own record of where a send failed (`getTransactionState()`), read
 * right after the call. With an external wallet (Freighter) the transaction is
 * built, then signed, then submitted: an error in `building` or `signing` was
 * never submitted. Compound phases (`signing-submitting`, the custodial
 * `building-signing-submitting`) and `submitting` stay unknown.
 */
export function failedBeforeSubmit(state: { step?: string; phase?: string } | null | undefined): boolean {
  return state?.step === "error" && (state.phase === "building" || state.phase === "signing");
}

/** {@link classifySubmit} plus the SDK's phase: a failure proven to come before submission is a rejection. */
export function classifyWithPhase(
  outcome: OutcomeLike | null | undefined,
  state: { step?: string; phase?: string } | null | undefined,
): "sent" | "rejected" | "unknown" {
  const verdict = classifySubmit(outcome);
  if (verdict === "unknown" && outcome?.status === "error" && !outcome.hash && failedBeforeSubmit(state)) return "rejected";
  return verdict;
}

/**
 * The sentence for a rejection plus what Pollar said when it is useful to act
 * on (a refused signature names the cause, e.g. an asset not enabled in the
 * dashboard). Never includes keys: it is the server's error text.
 */
export function rejectionText(reason: RejectionReason, outcome?: OutcomeLike | null): string {
  const base = rejectionMessage(reason);
  if (reason !== "signFailed") return base;
  const why = (outcome?.details ?? outcome?.message ?? "").trim().slice(0, 200);
  return why ? `${base} Pollar dijo: ${why}` : base;
}

export function rejectionMessage(reason: RejectionReason): string {
  switch (reason) {
    case "noWallet":
      return "Tu wallet no está conectada. Vuelve a entrar e intenta de nuevo. No se envió nada.";
    case "signFailed":
      return "Pollar no quiso firmar el pago, así que no se envió nada.";
    case "notReady":
      return "Pollar todavía no terminó de crear tu wallet, así que no se envió nada. Sal y vuelve a entrar para que lo reintente; si sigue igual, prueba entrando con Freighter.";
    case "declined":
      return "Cancelaste la firma: no se envió nada.";
    case "balance":
      return "No tienes saldo suficiente. Recuerda que cada envío también usa un poco de XLM para la comisión.";
    case "fee":
      return "La comisión de la red está alta ahora. No se envió nada; intenta en un momento.";
    case "destination":
      return "Esa wallet todavía no puede recibir este activo. No se envió nada.";
    default:
      return "No se pudo enviar. No se movió dinero; intenta de nuevo.";
  }
}

// ------------------------------------------------ finding a payment by memo

export interface HorizonPaymentRecord {
  type: string;
  from?: string;
  to?: string;
  transaction_hash?: string;
  created_at?: string;
  transaction?: { memo_type?: string; memo?: string };
}

/**
 * Hashes of `wallet`'s own payments carrying `memo`, newest first, once each.
 * Only payments FROM the wallet count: the memo is public, so anyone could
 * send the wallet a payment with it; those are skipped, not believed.
 */
export function memoCandidates(records: HorizonPaymentRecord[], wallet: string, memo: string): string[] {
  const hashes: string[] = [];
  for (const r of records) {
    if (
      r.type === "payment" &&
      r.from === wallet &&
      r.transaction?.memo_type === "text" &&
      (r.transaction.memo ?? "").trim() === memo &&
      r.transaction_hash &&
      TX_HASH_RE.test(r.transaction_hash) &&
      !hashes.includes(r.transaction_hash)
    ) {
      hashes.push(r.transaction_hash);
    }
  }
  return hashes;
}

/**
 * May an empty search be believed? Only if Horizon's ingested history closed
 * after the attempt's deadline: then every ledger that could hold it was searched.
 */
export function historyReaches(historyClosedAtMs: number | null, pastMs: number): boolean {
  return historyClosedAtMs !== null && Number.isFinite(historyClosedAtMs) && historyClosedAtMs > pastMs;
}

/** The wallet's latest 200 payments with their transactions (memo included). */
export async function fetchAccountPayments(
  wallet: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; records: HorizonPaymentRecord[] } | { ok: false }> {
  try {
    const res = await fetchImpl(
      `${HORIZON_URL}/accounts/${encodeURIComponent(wallet)}/payments?order=desc&limit=200&join=transactions`,
      { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) },
    );
    if (res.status === 404) return { ok: true, records: [] };
    if (!res.ok) return { ok: false };
    const body = (await res.json()) as { _embedded?: { records?: HorizonPaymentRecord[] } };
    return { ok: true, records: body._embedded?.records ?? [] };
  } catch {
    return { ok: false };
  }
}

/** When the newest ledger Horizon has ingested closed (ms), or null. Read BEFORE searching. */
export async function fetchHistoryClosedAt(fetchImpl: typeof fetch = fetch): Promise<number | null> {
  try {
    const res = await fetchImpl(`${HORIZON_URL}/`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { history_latest_ledger_closed_at?: unknown };
    const ms = typeof body.history_latest_ledger_closed_at === "string" ? Date.parse(body.history_latest_ledger_closed_at) : NaN;
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}
