'use client';

/**
 * Kosmovia Mini‑Apps · SDK para usar DENTRO de una mini‑app.
 *
 *   import { kosmovia } from '@/lib/miniapp-sdk/client';
 *   const ctx = await kosmovia.ready();
 *   const { user } = await kosmovia.connect();          // Kosmovia pide permisos + PIN
 *   const pago = await kosmovia.requestPayment({ to, amount: 0.01, asset: 'USDC' });
 *
 * Todo pasa por `postMessage` al host (Kosmovia). La app nunca ve el PIN, la
 * sesión ni las claves de la wallet.
 */

import {
  KV_PROTOCOL,
  isResponseMessage,
  type ConnectResult,
  type MiniAppContext,
  type MiniAppErrorCode,
  type MiniAppMethod,
  type MiniAppMethods,
  type MiniAppRequestMessage,
  type MiniAppUser,
  type PaymentRequest,
  type PaymentResult,
} from './protocol';

export class MiniAppError extends Error {
  constructor(
    public code: MiniAppErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MiniAppError';
  }
}

/** Tiempo máximo por método. Los que esperan a la persona (PIN) tienen más margen. */
const TIMEOUTS: Record<MiniAppMethod, number> = {
  ready: 10_000,
  connect: 5 * 60_000,
  getUser: 10_000,
  requestPayment: 10 * 60_000,
  share: 5 * 60_000,
  close: 5_000,
};

function inFrame(): boolean {
  try {
    return typeof window !== 'undefined' && window.parent !== window;
  } catch {
    return true;
  }
}

let counter = 0;

function call<M extends MiniAppMethod>(method: M, params: MiniAppMethods[M]['params']): Promise<MiniAppMethods[M]['result']> {
  if (!inFrame()) {
    return Promise.reject(new MiniAppError('not_in_kosmovia', 'Abre esta mini‑app desde Kosmovia.'));
  }
  const id = `${Date.now().toString(36)}-${(counter++).toString(36)}`;
  const message: MiniAppRequestMessage<M> = { protocol: KV_PROTOCOL, id, method, params };
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new MiniAppError('timeout', 'Kosmovia no respondió a tiempo.'));
    }, TIMEOUTS[method]);
    function onMessage(event: MessageEvent) {
      if (event.source !== window.parent) return;
      const data = event.data;
      if (!isResponseMessage(data) || data.id !== id) return;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      if (data.ok) resolve(data.result as MiniAppMethods[M]['result']);
      else reject(new MiniAppError(data.error.code, data.error.message));
    }
    window.addEventListener('message', onMessage);
    // Hoy las apps oficiales corren en el mismo origen; las de terceros tendrán el suyo
    // y el host valida el origen de cada mensaje.
    window.parent.postMessage(message, '*');
  });
}

export const kosmovia = {
  /** ¿Se está corriendo dentro de Kosmovia? */
  isInKosmovia: inFrame,
  /** Avisa que la app cargó y recibe el contexto (comunidad, canal, tema, parámetros). */
  ready: (): Promise<MiniAppContext> => call('ready', undefined),
  /** Conecta la wallet de Kosmovia (permisos + PIN, en la interfaz de Kosmovia). */
  connect: (): Promise<ConnectResult> => call('connect', undefined),
  /** Usuario conectado; lanza `not_connected` si todavía no se conectó. */
  getUser: (): Promise<MiniAppUser> => call('getUser', undefined),
  /** Pide un pago en USDC; Kosmovia muestra su confirmación con PIN. */
  requestPayment: (req: PaymentRequest): Promise<PaymentResult> => call('requestPayment', req),
  /** Publica un mensaje en el canal activo (la persona lo confirma). */
  share: (text: string): Promise<{ messageId: string }> => call('share', { text }),
  /** Cierra la app. */
  close: (): Promise<void> => call('close', undefined),
};

export type { ConnectResult, MiniAppContext, MiniAppUser, PaymentRequest, PaymentResult } from './protocol';
