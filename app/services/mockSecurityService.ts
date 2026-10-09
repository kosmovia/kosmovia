/**
 * Modo demo del PIN de pagos: el mismo contrato que el backend, con el estado en
 * localStorage. Sirve para probar las pantallas sin servidor; NO protege nada
 * (el "hash" es solo para no dejar el PIN a la vista). Usa las mismas reglas
 * puras que el servidor (lib/core/pin-rules.ts): formato, PIN trivial, bloqueo
 * progresivo, límites y topes de monto.
 */
import { checkAmount } from '../lib/core/payments.ts';
import {
  APPROVAL_TTL_MS,
  DEFAULT_DAILY_LIMIT,
  PIN_RESET_DELAY_MS,
  attemptsLeft,
  isLocked,
  isPinFormat,
  limitDecision,
  nextFailureState,
  parseDailyLimit,
  stateAfterSuccess,
  validatePin,
} from '../lib/core/pin-rules.ts';
import {
  SecurityError,
  type ApproveInput,
  type ISecurityService,
  type PayAsset,
  type PaymentApproval,
  type ResetPinResult,
  type SecurityStatus,
} from './securityService';
import { storage } from './storage';

const STORAGE_KEY = 'kosmovia_security_mock';
const DAY_MS = 24 * 60 * 60 * 1000;
const ADDRESS_RE = /^G[A-Z2-7]{55}$/;
const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
/** Dirección con formato válido para los @usuario de la demo (en demo no hay perfiles que resolver). */
const DEMO_WALLET = `G${'A'.repeat(55)}`;

interface MockApproval {
  at: number;
  asset: PayAsset;
  amount: string;
}

interface MockState {
  salt: string;
  hash: string | null;
  failedAttempts: number;
  lockLevel: number;
  lockedUntil: number | null;
  /** "Olvidé mi PIN" pendiente: el PIN nuevo (hash y sal) y cuándo se activa (epoch ms). */
  pendingSalt: string;
  pendingHash: string | null;
  pendingAt: number | null;
  limits: Record<PayAsset, number>;
  approvals: MockApproval[];
}

function freshState(): MockState {
  return {
    salt: '',
    hash: null,
    failedAttempts: 0,
    lockLevel: 0,
    lockedUntil: null,
    pendingSalt: '',
    pendingHash: null,
    pendingAt: null,
    limits: { USDC: DEFAULT_DAILY_LIMIT.USDC, XLM: DEFAULT_DAILY_LIMIT.XLM },
    approvals: [],
  };
}

const save = (state: MockState) => storage.set(STORAGE_KEY, state);

/** Lee el estado; un reset pendiente que ya cumplió sus 24 h se activa aquí (igual que el servidor, sin cron). */
function load(now = Date.now()): MockState {
  const state: MockState = { ...freshState(), ...storage.get<Partial<MockState>>(STORAGE_KEY, {}) };
  if (state.pendingHash !== null && state.pendingAt !== null && state.pendingAt <= now) {
    state.salt = state.pendingSalt;
    state.hash = state.pendingHash;
    state.pendingSalt = '';
    state.pendingHash = null;
    state.pendingAt = null;
    Object.assign(state, stateAfterSuccess());
    save(state);
  }
  return state;
}

async function digest(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return String(h);
}

const newSalt = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function spentIn24h(state: MockState, asset: PayAsset, now: number): string {
  // La demo no sabe cuáles permisos se usaron: cuenta todos los de las últimas 24 h.
  const total = state.approvals
    .filter((a) => a.asset === asset && now - a.at < DAY_MS)
    .reduce((sum, a) => sum + Number(a.amount), 0);
  return total.toFixed(7);
}

function toStatus(state: MockState, now: number): SecurityStatus {
  return {
    hasPin: state.hash !== null,
    lockedUntil: isLocked(state.lockedUntil, now) ? new Date(state.lockedUntil as number).toISOString() : null,
    pendingPinAt: state.pendingAt !== null && state.pendingHash !== null ? new Date(state.pendingAt).toISOString() : null,
    dailyLimit: { USDC: state.limits.USDC, XLM: state.limits.XLM },
    spentToday: { USDC: Number(spentIn24h(state, 'USDC', now)), XLM: Number(spentIn24h(state, 'XLM', now)) },
  };
}

export class MockSecurityService implements ISecurityService {
  /** Verifica el PIN con el mismo bloqueo progresivo del servidor. Lanza `SecurityError`. */
  private async verify(state: MockState, pin: string): Promise<void> {
    if (state.hash === null) throw new SecurityError('Primero crea tu PIN de pagos.', 'no_pin');
    if (!isPinFormat(pin)) throw new SecurityError('El PIN son exactamente 6 dígitos.', 'invalid_pin');
    const now = Date.now();
    if (isLocked(state.lockedUntil, now)) {
      throw new SecurityError('Demasiados intentos. Tu PIN está bloqueado por un rato.', 'locked', {
        lockedUntil: new Date(state.lockedUntil as number).toISOString(),
      });
    }
    if ((await digest(state.salt + pin)) === state.hash) {
      Object.assign(state, stateAfterSuccess());
      save(state);
      return;
    }
    const next = nextFailureState(state, now);
    state.failedAttempts = next.failedAttempts;
    state.lockLevel = next.lockLevel;
    state.lockedUntil = next.lockedUntil;
    save(state);
    if (next.lockedUntil !== null) {
      throw new SecurityError('Demasiados intentos. Tu PIN está bloqueado por un rato.', 'locked', {
        lockedUntil: new Date(next.lockedUntil).toISOString(),
      });
    }
    const left = attemptsLeft(next.failedAttempts);
    throw new SecurityError(`PIN incorrecto. Te ${left === 1 ? 'queda 1 intento' : `quedan ${left} intentos`}.`, 'wrong_pin', {
      attemptsLeft: left,
    });
  }

  private async store(state: MockState, pin: string): Promise<void> {
    state.salt = newSalt();
    state.hash = await digest(state.salt + pin);
    state.failedAttempts = 0;
    state.lockLevel = 0;
    state.lockedUntil = null;
    // Cambiar el PIN cancela un reset pendiente.
    state.pendingSalt = '';
    state.pendingHash = null;
    state.pendingAt = null;
    save(state);
  }

  async getStatus(): Promise<SecurityStatus> {
    return toStatus(load(), Date.now());
  }

  async setPin(pin: string, currentPin?: string): Promise<void> {
    const check = validatePin(pin);
    if (!check.ok) throw new SecurityError(check.error, check.code);
    const state = load();
    if (state.hash !== null) {
      if (currentPin === undefined) throw new SecurityError('Ya tienes un PIN. Para cambiarlo escribe el actual.', 'pin_exists');
      await this.verify(state, currentPin);
    }
    await this.store(state, pin);
  }

  async resetPin(pin: string): Promise<ResetPinResult> {
    const check = validatePin(pin);
    if (!check.ok) throw new SecurityError(check.error, check.code);
    // En la demo no hay sesión que exigir: siempre se puede.
    const state = load();
    if (state.hash === null) {
      await this.store(state, pin);
      return { pendingPinAt: null };
    }
    if (state.pendingHash !== null && state.pendingAt !== null) {
      throw new SecurityError('Ya hay un cambio de PIN pendiente.', 'reset_pending', {
        pendingPinAt: new Date(state.pendingAt).toISOString(),
      });
    }
    // El PIN actual sigue valiendo; el nuevo se activa a las 24 h.
    state.pendingSalt = newSalt();
    state.pendingHash = await digest(state.pendingSalt + pin);
    state.pendingAt = Date.now() + PIN_RESET_DELAY_MS;
    save(state);
    return { pendingPinAt: new Date(state.pendingAt).toISOString() };
  }

  async cancelPinReset(pin: string): Promise<void> {
    const state = load();
    await this.verify(state, pin);
    state.pendingSalt = '';
    state.pendingHash = null;
    state.pendingAt = null;
    save(state);
  }

  async setDailyLimit(limits: Partial<Record<PayAsset, number>>, pin: string): Promise<SecurityStatus> {
    const parsed: Partial<Record<PayAsset, number>> = {};
    for (const asset of ['USDC', 'XLM'] as const) {
      if (limits[asset] === undefined) continue;
      const p = parseDailyLimit(limits[asset]);
      if (!p.ok) throw new SecurityError(`${asset}: ${p.error}`, 'unknown');
      parsed[asset] = Number(p.amount);
    }
    if (Object.keys(parsed).length === 0) throw new SecurityError('Indica el límite de USDC, de XLM o de los dos.', 'unknown');
    const state = load();
    await this.verify(state, pin);
    state.limits = { ...state.limits, ...parsed };
    save(state);
    return toStatus(state, Date.now());
  }

  async approve(input: ApproveInput): Promise<PaymentApproval> {
    const raw = input.to.trim();
    const handle = raw.replace(/^@/, '').toLowerCase();
    const isAddress = ADDRESS_RE.test(raw.toUpperCase());
    if (!isAddress && !HANDLE_RE.test(handle)) {
      throw new SecurityError('Escribe un @usuario o una dirección G….', 'invalid_recipient');
    }
    const checked = checkAmount(String(input.amount), input.asset);
    if (!checked.ok) throw new SecurityError(checked.error, 'unknown');

    const state = load();
    await this.verify(state, input.pin);

    const now = Date.now();
    const decision = limitDecision(String(state.limits[input.asset]), spentIn24h(state, input.asset, now), checked.amount);
    if (!decision.ok) {
      throw new SecurityError('Con este pago pasarías tu límite diario.', 'limit_exceeded', { remaining: decision.remaining });
    }
    state.approvals = [...state.approvals.filter((a) => now - a.at < DAY_MS), { at: now, asset: input.asset, amount: checked.amount }];
    save(state);

    const toWallet = isAddress ? raw.toUpperCase() : DEMO_WALLET;
    return {
      id: `demo-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      toWallet,
      toLabel: isAddress ? `${toWallet.slice(0, 4)}…${toWallet.slice(-4)}` : `@${handle}`,
      asset: input.asset,
      amount: Number(checked.amount),
      expiresAt: new Date(now + APPROVAL_TTL_MS).toISOString(),
    };
  }
}
