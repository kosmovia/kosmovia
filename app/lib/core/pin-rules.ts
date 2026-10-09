import { fromStroops, toStroops } from "./payments.ts";

/**
 * Reglas puras del PIN de pagos: formato, PINs triviales, bloqueo progresivo,
 * límites diarios y cuándo un permiso respalda un pago. Sin node:crypto ni base
 * de datos, así las usan igual el servidor (lib/core/pin.ts), el modo demo del
 * navegador y los tests. El hash del PIN está aparte, en pin.ts (solo servidor).
 */

export const PIN_LENGTH = 6;

/** Fallos seguidos que disparan un bloqueo. */
export const MAX_FAILED_ATTEMPTS = 5;
/** Primer bloqueo; cada bloqueo seguido duplica el anterior (15 min, 30 min, 1 h…). */
export const LOCK_BASE_MS = 15 * 60 * 1000;
/** Tope del bloqueo. */
export const LOCK_MAX_MS = 24 * 60 * 60 * 1000;
/** Tope de `lock_level` (la migración lo exige igual): 2^30 ya pasa de sobra las 24 h. */
export const MAX_LOCK_LEVEL = 30;

/** Un permiso vale 5 minutos (lo mismo que la vida de una transacción) y se usa una sola vez. */
export const APPROVAL_TTL_MS = 5 * 60 * 1000;
/** "Olvidé mi PIN": el PIN nuevo se activa a las 24 h; mientras tanto vale el actual y puede cancelarlo. */
export const PIN_RESET_DELAY_MS = 24 * 60 * 60 * 1000;
/** Holgura entre el reloj de la base y el cierre del ledger al ligar un pago con su permiso. */
export const APPROVAL_GRACE_MS = 60 * 1000;
/** Para olvidar el PIN, la sesión tiene que haberse emitido hace menos que esto. */
export const RESET_MAX_SESSION_AGE_MS = 10 * 60 * 1000;

export const DEFAULT_DAILY_LIMIT = { USDC: 100, XLM: 1000 } as const;
/** Tope de un límite diario (la migración lo exige igual). */
export const MAX_DAILY_LIMIT = 100_000;

export type PinCheck =
  | { ok: true; pin: string }
  | { ok: false; code: "invalid_pin" | "weak_pin"; error: string };

const PIN_RE = /^[0-9]{6}$/;

/**
 * Los patrones que cualquiera prueba primero. Se mira el PIN como dígitos:
 * todos iguales (000000), secuencias (123456, 654321, 345678), pares repetidos
 * (121212), pares dobles (112233), tríos repetidos (123123) y capicúas (123321).
 */
export function isTrivialPin(pin: string): boolean {
  const d = Array.from(pin, Number);
  if (d.every((x) => x === d[0])) return true;
  const step = d[1] - d[0];
  if ((step === 1 || step === -1) && d.every((x, i) => i === 0 || x - d[i - 1] === step)) return true;
  if (d[0] === d[2] && d[2] === d[4] && d[1] === d[3] && d[3] === d[5]) return true; // ababab
  if (d[0] === d[1] && d[2] === d[3] && d[4] === d[5]) return true; // aabbcc
  if (d[0] === d[3] && d[1] === d[4] && d[2] === d[5]) return true; // abcabc
  if (d[0] === d[5] && d[1] === d[4] && d[2] === d[3]) return true; // abccba
  return false;
}

export function validatePin(pin: unknown): PinCheck {
  if (typeof pin !== "string" || !PIN_RE.test(pin)) {
    return { ok: false, code: "invalid_pin", error: `El PIN son exactamente ${PIN_LENGTH} dígitos.` };
  }
  if (isTrivialPin(pin)) {
    return { ok: false, code: "weak_pin", error: "Ese PIN es muy fácil de adivinar (como 123456 o 000000). Elige otro." };
  }
  return { ok: true, pin };
}

/** Solo el formato (para verificar un PIN que ya existe: un PIN antiguo débil no se rechaza aquí). */
export function isPinFormat(pin: unknown): pin is string {
  return typeof pin === "string" && PIN_RE.test(pin);
}

// ----------------------------------------------------------------- bloqueo

export interface FailureState {
  failedAttempts: number;
  lockLevel: number;
}

export interface NextFailureState extends FailureState {
  /** Epoch ms; null si este fallo todavía no bloquea. */
  lockedUntil: number | null;
}

/** 15 min * 2^nivel, con tope de 24 h. */
export function lockDurationMs(level: number): number {
  const lvl = Math.min(Math.max(Math.trunc(level), 0), MAX_LOCK_LEVEL);
  return Math.min(LOCK_BASE_MS * 2 ** lvl, LOCK_MAX_MS);
}

/**
 * Estado después de un fallo. Al llegar a 5: bloquea por `lockDurationMs(nivel)`,
 * sube el nivel y vuelve los intentos a 0. (El SQL de repo/sql.ts hace lo mismo
 * dentro de un solo UPDATE; esta función es la regla de referencia y la del modo demo.)
 */
export function nextFailureState(state: FailureState, now: number): NextFailureState {
  const failed = state.failedAttempts + 1;
  if (failed >= MAX_FAILED_ATTEMPTS) {
    return {
      failedAttempts: 0,
      lockLevel: Math.min(state.lockLevel + 1, MAX_LOCK_LEVEL),
      lockedUntil: now + lockDurationMs(state.lockLevel),
    };
  }
  return { failedAttempts: failed, lockLevel: state.lockLevel, lockedUntil: null };
}

/** Un acierto lo deja todo en cero. */
export function stateAfterSuccess(): NextFailureState {
  return { failedAttempts: 0, lockLevel: 0, lockedUntil: null };
}

export function attemptsLeft(failedAttempts: number): number {
  return Math.max(MAX_FAILED_ATTEMPTS - failedAttempts, 0);
}

export function isLocked(lockedUntil: number | null, now: number): boolean {
  return lockedUntil !== null && lockedUntil > now;
}

// ------------------------------------------------------------------ límites

export type LimitCheck = { ok: true; amount: string } | { ok: false; error: string };

/** Un límite diario: número o texto, mayor que 0, hasta MAX_DAILY_LIMIT y 7 decimales. */
export function parseDailyLimit(value: unknown): LimitCheck {
  // Un número se redondea a 7 lugares (0.1 + 0.2 no debe fallar); fuera de rango queda vacío y se rechaza.
  const raw =
    typeof value === "number"
      ? Number.isFinite(value) && value >= 0 && value < 1e12
        ? value.toFixed(7)
        : ""
      : typeof value === "string"
        ? value.trim().replace(",", ".")
        : "";
  const stroops = toStroops(raw);
  if (stroops === null) return { ok: false, error: "El límite tiene que ser un número, con hasta 7 decimales." };
  if (stroops <= BigInt(0)) return { ok: false, error: "El límite tiene que ser mayor que 0." };
  if (stroops > (toStroops(String(MAX_DAILY_LIMIT)) as bigint)) {
    return { ok: false, error: `El límite máximo es ${MAX_DAILY_LIMIT} por día.` };
  }
  return { ok: true, amount: fromStroops(stroops) };
}

export type LimitDecision = { ok: true } | { ok: false; remaining: number };

/** ¿Cabe `amount` en lo que queda del límite? Todo en stroops, sin floats. `remaining` en unidades del activo. */
export function limitDecision(limit: string, spent: string, amount: string): LimitDecision {
  const l = toStroops(limit);
  const s = toStroops(spent);
  const a = toStroops(amount);
  if (l === null || s === null || a === null) return { ok: false, remaining: 0 };
  if (s + a <= l) return { ok: true };
  const left = l > s ? l - s : BigInt(0);
  return { ok: false, remaining: Number(fromStroops(left)) };
}

// ----------------------------------------------------------------- permisos

export interface ApprovalFacts {
  profileId: string;
  toWallet: string;
  asset: string;
  /** Decimal con hasta 7 lugares. */
  amount: string;
  /** Epoch ms. */
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  /** La versión del PIN con la que se verificó el permiso. */
  pinVersion: number;
}

/** El PIN vigente al registrar el pago: su versión y cuándo se puso (epoch ms; null si no se sabe). */
export interface CurrentPin {
  version: number;
  setAt: number | null;
}

export interface PaymentFacts {
  profileId: string;
  toWallet: string;
  asset: string;
  amount: string;
  /** Cierre del ledger (`paid_at`), epoch ms. */
  paidAt: number;
}

/**
 * ¿Este permiso respalda este pago? Mismo perfil, mismo destino, mismo activo,
 * monto exacto, sin usar, y el pago cerró dentro de la vida del permiso (con
 * APPROVAL_GRACE_MS de holgura a cada lado por la diferencia de relojes).
 *
 * Versión del PIN (decisión más segura): el permiso cuenta si se hizo con la
 * versión de PIN vigente, o si el pago cerró ANTES de que el PIN cambiara (el
 * permiso era válido cuando se pagó, aunque el registro llegue tarde). Un pago
 * que cierra después del cambio con un permiso del PIN anterior no cuenta:
 * queda sin verificar. El UPDATE de sql.claimApproval aplica lo mismo en la base.
 */
export function approvalMatches(approval: ApprovalFacts, payment: PaymentFacts, pin: CurrentPin): boolean {
  if (approval.usedAt !== null) return false;
  if (approval.profileId !== payment.profileId) return false;
  if (approval.toWallet !== payment.toWallet) return false;
  if (approval.asset !== payment.asset) return false;
  const a = toStroops(approval.amount);
  const p = toStroops(payment.amount);
  if (a === null || p === null || a !== p) return false;
  if (payment.paidAt > approval.expiresAt + APPROVAL_GRACE_MS) return false;
  if (payment.paidAt < approval.createdAt - APPROVAL_GRACE_MS) return false;
  if (approval.pinVersion !== pin.version && !(pin.setAt !== null && payment.paidAt < pin.setAt)) return false;
  return true;
}

/** ¿La sesión se emitió hace poco como para olvidar el PIN? `iatMs` es el `iat` del JWT en ms. */
export function sessionIsFresh(iatMs: number, now: number): boolean {
  return Number.isFinite(iatMs) && now - iatMs < RESET_MAX_SESSION_AGE_MS && iatMs <= now + 60_000;
}
