/**
 * Seguridad al pagar: PIN de 6 dígitos (y más adelante huella/passkey) antes de
 * mover dinero. Contrato compartido entre la UI y el backend.
 *
 * Qué es y qué NO es: el PIN es un control de la app más detección, no una
 * barrera criptográfica. Los pagos los firma Pollar desde el navegador, así que
 * quien pueda ejecutar código en la página puede llamar a Pollar sin pasar por
 * el PIN. Lo que sí hace el servidor: exige el PIN para dar el permiso, aplica el
 * límite diario a los permisos y, cuando un pago llega sin permiso válido, lo
 * guarda marcado como `unverified` para avisarle al dueño.
 *
 * Flujo de un pago:
 * 1. La UI llama a `approve({ to, asset, amount, pin })`. El servidor verifica
 *    el PIN, el bloqueo y el límite diario, resuelve `to` (@usuario o G…) y
 *    devuelve un permiso de un solo uso, atado a ese destino, activo y monto,
 *    que vence en 5 minutos.
 * 2. La UI llama a `walletService.sendPayment({ ..., approval })`, que revisa que
 *    `to` sea el destino aprobado, paga a `approval.toWallet` y manda
 *    `approval.id` al registrar el pago.
 * 3. Al registrar, el servidor consume el permiso. Un pago que llega sin
 *    permiso válido igual se guarda (el dinero ya se movió), pero marcado como
 *    `unverified` para avisarle al dueño.
 */

export type PayAsset = 'USDC' | 'XLM';

export interface SecurityStatus {
  /** Ya creó su PIN. */
  hasPin: boolean;
  /** ISO, si está bloqueado por intentos fallidos; null si no. */
  lockedUntil: string | null;
  /**
   * ISO de cuándo se activa el PIN nuevo de un "olvidé mi PIN" pendiente; null si no hay.
   * Mientras tanto sigue valiendo el PIN actual, que además puede cancelar el cambio.
   */
  pendingPinAt: string | null;
  /** Límite por 24 h móviles, por activo. */
  dailyLimit: Record<PayAsset, number>;
  /** Todo lo aprobado en las últimas 24 h, por activo (usado o no: un permiso sin usar no libera cupo). */
  spentToday: Record<PayAsset, number>;
}

export interface PaymentApproval {
  id: string;
  /** Dirección G… ya resuelta: es el destino que se paga. */
  toWallet: string;
  /** Cómo se mostró el destino (@usuario o G… abreviada). */
  toLabel: string;
  asset: PayAsset;
  amount: number;
  /** ISO. */
  expiresAt: string;
}

export interface ApproveInput {
  /** @usuario (con o sin @) o dirección G…. */
  to: string;
  asset: PayAsset;
  amount: number;
  pin: string;
}

/** Códigos de error que la UI distingue (vienen en `SecurityError.code`). */
export type SecurityErrorCode =
  | 'no_pin' // todavía no creó su PIN
  | 'wrong_pin' // PIN incorrecto; `attemptsLeft` dice cuántos quedan
  | 'locked' // bloqueado; `lockedUntil` dice hasta cuándo
  | 'limit_exceeded' // supera el límite diario; `remaining` dice cuánto queda
  | 'weak_pin' // PIN trivial (000000, 123456…)
  | 'invalid_pin' // no son 6 dígitos
  | 'pin_exists' // ya tiene PIN (para cambiarlo hay que dar el actual)
  | 'reauth_required' // olvidó el PIN: tiene que volver a iniciar sesión primero
  | 'reset_pending' // ya hay un cambio de PIN pendiente; `pendingPinAt` dice cuándo se activa
  | 'pin_changed' // el PIN cambió mientras se hacía la operación: que lo intente de nuevo
  | 'invalid_recipient'
  | 'unknown';

export class SecurityError extends Error {
  constructor(
    message: string,
    public code: SecurityErrorCode,
    public extra: { attemptsLeft?: number; lockedUntil?: string; remaining?: number; pendingPinAt?: string } = {},
  ) {
    super(message);
    this.name = 'SecurityError';
  }
}

/** Qué pasó con un "olvidé mi PIN". */
export interface ResetPinResult {
  /** ISO de cuándo se activa el PIN nuevo; null si quedó activo al instante (era el primer PIN). */
  pendingPinAt: string | null;
}

export interface ISecurityService {
  getStatus(): Promise<SecurityStatus>;
  /** Crea el PIN (si no tenía) o lo cambia (`currentPin` obligatorio si ya tenía). */
  setPin(pin: string, currentPin?: string): Promise<void>;
  /**
   * Olvidó el PIN: solo vale con una sesión iniciada hace menos de 10 minutos. Si ya
   * tenía PIN, el nuevo NO reemplaza al actual al instante: se activa a las 24 h
   * (`pendingPinAt`), y mientras tanto el actual vale y puede cancelarlo con `cancelPinReset`.
   */
  resetPin(pin: string): Promise<ResetPinResult>;
  /** Cancela el cambio de PIN pendiente; pide el PIN actual. */
  cancelPinReset(pin: string): Promise<void>;
  /** Cambia los límites diarios; pide el PIN. */
  setDailyLimit(limits: Partial<Record<PayAsset, number>>, pin: string): Promise<SecurityStatus>;
  /** Verifica el PIN y devuelve el permiso para ese pago. Lanza `SecurityError`. */
  approve(input: ApproveInput): Promise<PaymentApproval>;
}
