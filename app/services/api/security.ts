/**
 * Adapter "api" del PIN de pagos: habla con /api/security/* y traduce las
 * respuestas de error a `SecurityError` (con su `code` y los datos extra que la
 * UI muestra: intentos que quedan, hasta cuándo está bloqueado, cuánto cabe en
 * el límite). Un PIN incorrecto llega como 422 (no 401, que el cliente tomaría
 * por sesión vencida y repetiría el pedido gastando otro intento).
 */
import { apiRequest } from '../../lib/core/api-client.ts';
import { checkAmount } from '../../lib/core/payments.ts';
import {
  SecurityError,
  type ApproveInput,
  type ISecurityService,
  type PayAsset,
  type PaymentApproval,
  type ResetPinResult,
  type SecurityErrorCode,
  type SecurityStatus,
} from '../securityService';

const KNOWN_CODES: readonly SecurityErrorCode[] = [
  'no_pin',
  'wrong_pin',
  'locked',
  'limit_exceeded',
  'weak_pin',
  'invalid_pin',
  'pin_exists',
  'reauth_required',
  'reset_pending',
  'pin_changed',
  'invalid_recipient',
];

type Failed = { status: number; error: string; code?: string; extra?: Record<string, unknown> };

export function toSecurityError(res: Failed): SecurityError {
  const code = KNOWN_CODES.includes(res.code as SecurityErrorCode) ? (res.code as SecurityErrorCode) : 'unknown';
  const extra: SecurityError['extra'] = {};
  if (typeof res.extra?.attemptsLeft === 'number') extra.attemptsLeft = res.extra.attemptsLeft;
  if (typeof res.extra?.lockedUntil === 'string') extra.lockedUntil = res.extra.lockedUntil;
  if (typeof res.extra?.remaining === 'number') extra.remaining = res.extra.remaining;
  if (typeof res.extra?.pendingPinAt === 'string') extra.pendingPinAt = res.extra.pendingPinAt;
  return new SecurityError(res.error, code, extra);
}

async function request<T>(path: string, init?: Parameters<typeof apiRequest>[1]): Promise<T> {
  const res = await apiRequest<T>(path, init);
  if (!res.ok) throw toSecurityError(res);
  return res.data;
}

export class ApiSecurityService implements ISecurityService {
  getStatus(): Promise<SecurityStatus> {
    return request<SecurityStatus>('/api/security');
  }

  async setPin(pin: string, currentPin?: string): Promise<void> {
    await request('/api/security/pin', { method: 'PUT', body: currentPin === undefined ? { pin } : { pin, currentPin } });
  }

  async resetPin(pin: string): Promise<ResetPinResult> {
    // 204: era el primer PIN y quedó activo. 202 { pendingPinAt }: se activa a las 24 h.
    const data = await request<{ pendingPinAt?: string }>('/api/security/pin/reset', { method: 'POST', body: { pin } });
    return { pendingPinAt: typeof data?.pendingPinAt === 'string' ? data.pendingPinAt : null };
  }

  async cancelPinReset(pin: string): Promise<void> {
    await request('/api/security/pin/reset', { method: 'DELETE', body: { pin } });
  }

  setDailyLimit(limits: Partial<Record<PayAsset, number>>, pin: string): Promise<SecurityStatus> {
    return request<SecurityStatus>('/api/security/limits', { method: 'PUT', body: { ...limits, pin } });
  }

  approve(input: ApproveInput): Promise<PaymentApproval> {
    // El monto se normaliza igual que en sendPayment, así el permiso y el pago llevan exactamente el mismo.
    const checked = checkAmount(String(input.amount), input.asset);
    const amount = checked.ok ? checked.amount : String(input.amount);
    return request<PaymentApproval>('/api/security/approve', {
      method: 'POST',
      body: { to: input.to, asset: input.asset, amount, pin: input.pin },
    });
  }
}
