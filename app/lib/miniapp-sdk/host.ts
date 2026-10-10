/**
 * Kosmovia Mini-Apps · lógica PURA del host (sin React ni DOM).
 *
 * `components/apps/MiniAppHost.tsx` escucha los mensajes de la mini-app y, para
 * cada uno, le pregunta a `decideRequest` qué hacer según si la persona conectó
 * la app y qué permisos tiene. El componente solo ejecuta lo que se decide
 * (mostrar la hoja de conexión, pedir el PIN, pagar…). Así las reglas de
 * seguridad se prueban sin navegador (tests/miniapps.test.mts).
 */

import { MESSAGE_MAX } from '../core/validation.ts';
import { ADDRESS_RE, checkAmount, cleanNote } from '../core/payments.ts';
import {
  KV_PROTOCOL,
  type MiniAppContext,
  type MiniAppErrorCode,
  type MiniAppMethod,
  type MiniAppPermission,
  type MiniAppRequestMessage,
  type MiniAppResponseMessage,
  type MiniAppUser,
  type PaymentRequest,
} from './protocol.ts';

// ------------------------------------------------------------------ iframe

/**
 * `sandbox` del iframe de las apps oficiales. `allow-same-origin` va porque la app
 * oficial corre en el MISMO origen que Kosmovia y usa la sesión (cookie): es de
 * confianza porque la escribimos nosotros. Con `allow-scripts` + `allow-same-origin`
 * en el mismo origen, la app podría quitarse el sandbox, así que esto NUNCA se usa
 * con código de terceros.
 *
 * Las apps de terceros (más adelante, ya aprobadas) irán en su PROPIO origen y sin
 * `allow-same-origin`: el navegador las trata como origen opaco, sin acceso a la
 * sesión ni al almacenamiento de Kosmovia. Por eso `frameConfig` quita ese permiso
 * cuando la URL no es del mismo origen.
 */
export const SANDBOX_FIRST_PARTY = 'allow-scripts allow-forms allow-same-origin allow-popups';
export const SANDBOX_THIRD_PARTY = 'allow-scripts allow-forms allow-popups';

export interface FrameConfig {
  /** URL absoluta que carga el iframe. */
  src: string;
  sandbox: string;
  /** Origen que deben traer los mensajes de la app (un iframe sin same-origin manda "null"). */
  expectedOrigin: string;
  sameOrigin: boolean;
}

/** Cómo cargar la app en `url` (ruta o URL) dentro de un host con origen `hostOrigin`. Null si la URL no sirve. */
export function frameConfig(url: string, hostOrigin: string): FrameConfig | null {
  let target: URL;
  try {
    target = new URL(url, hostOrigin);
  } catch {
    return null;
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return null;
  const sameOrigin = target.origin === new URL(hostOrigin).origin;
  return {
    src: target.toString(),
    sandbox: sameOrigin ? SANDBOX_FIRST_PARTY : SANDBOX_THIRD_PARTY,
    expectedOrigin: sameOrigin ? target.origin : 'null',
    sameOrigin,
  };
}

/** ¿Un mensaje viene de la mini-app? Tiene que ser del `contentWindow` de NUESTRO iframe y del origen esperado. */
export function isTrustedSender(input: { fromFrame: boolean; origin: string; expectedOrigin: string }): boolean {
  return input.fromFrame && input.origin === input.expectedOrigin;
}

// ------------------------------------------------------------------ mensajes

const METHODS: readonly MiniAppMethod[] = ['ready', 'connect', 'getUser', 'requestPayment', 'share', 'close'];

export function isKnownMethod(method: string): method is MiniAppMethod {
  return (METHODS as readonly string[]).includes(method);
}

export function okResponse(id: string, result: unknown): MiniAppResponseMessage {
  return { protocol: KV_PROTOCOL, id, ok: true, result } as MiniAppResponseMessage;
}

export function errorResponse(id: string, code: MiniAppErrorCode, message: string): MiniAppResponseMessage {
  return { protocol: KV_PROTOCOL, id, ok: false, error: { code, message } };
}

// ------------------------------------------------------------------ datos que ve la app

/** Solo lo público de la persona. Nunca llega nada más a la app. */
export function toMiniAppUser(user: {
  id: string;
  username: string;
  displayName: string;
  avatar?: string | null;
  wallet?: string | null;
}): MiniAppUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar ?? null,
    wallet: user.wallet ?? '',
  };
}

export function buildContext(input: {
  community: { id: string; slug: string; name: string } | null;
  channel: { id: string; name: string } | null;
  theme: 'kosmovia' | 'negro';
  params?: Record<string, unknown>;
}): MiniAppContext {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.params ?? {})) {
    if (typeof value === 'string') params[key] = value;
  }
  return {
    community: input.community ? { id: input.community.id, slug: input.community.slug, name: input.community.name } : null,
    channel: input.channel ? { id: input.channel.id, name: input.channel.name } : null,
    theme: input.theme,
    params,
  };
}

// ------------------------------------------------------------------ permisos

/** Lo que Kosmovia le dice a la persona que la app va a poder hacer (hoja de conexión). */
export const PERMISSION_SHEET_TEXT: Record<MiniAppPermission, string> = {
  perfil: 'ver tu @usuario y perfil público',
  pagos: 'pedirte pagos (siempre con tu PIN)',
  mensajes: 'publicar en el canal',
};

/** "ver tu @usuario y perfil público · pedirte pagos (siempre con tu PIN) · publicar en el canal". */
export function permissionLines(permissions: readonly MiniAppPermission[]): string[] {
  return permissions.map((p) => PERMISSION_SHEET_TEXT[p]);
}

/**
 * ¿La conexión guardada cubre todo lo que la app pide hoy? Si el catálogo le agregó
 * un permiso después de que la persona conectó, hay que volver a pedir el PIN.
 */
export function connectionCovers(
  connection: { permissions: readonly MiniAppPermission[] } | null,
  appPermissions: readonly MiniAppPermission[],
): boolean {
  if (!connection) return false;
  return appPermissions.every((p) => connection.permissions.includes(p));
}

// ------------------------------------------------------------------ decisiones

export interface HostState {
  /** Permisos que la app tiene en el catálogo. */
  appPermissions: readonly MiniAppPermission[];
  /** La conexión de esta persona con esta app, o null. */
  connection: { permissions: readonly MiniAppPermission[] } | null;
  /** Hay un canal activo donde publicar. */
  hasChannel: boolean;
}

export type HostDecision =
  | { action: 'ready' }
  /** Mostrar la hoja de Kosmovia (permisos + PIN). */
  | { action: 'connect' }
  /** Ya estaba conectada: responder `{ user, permissions }`. */
  | { action: 'connected' }
  | { action: 'user' }
  | { action: 'pay'; payment: PaymentRequest }
  | { action: 'share'; text: string }
  | { action: 'close' }
  | { action: 'error'; code: MiniAppErrorCode; message: string };

const fail = (code: MiniAppErrorCode, message: string): HostDecision => ({ action: 'error', code, message });

const HANDLE_RE = /^@?[a-zA-Z0-9_]{3,20}$/;

/** Valida los parámetros de `requestPayment`. Nada de lo que manda la app se usa sin pasar por aquí. */
export function parsePaymentRequest(params: unknown): { ok: true; payment: PaymentRequest } | { ok: false; message: string } {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return { ok: false, message: 'Faltan los datos del pago.' };
  const p = params as Record<string, unknown>;
  if (typeof p.to !== 'string') return { ok: false, message: 'Indica a quién se paga.' };
  const to = p.to.trim();
  if (!ADDRESS_RE.test(to.toUpperCase()) && !HANDLE_RE.test(to)) return { ok: false, message: 'El destinatario tiene que ser un @usuario o una dirección G….' };
  if (p.asset !== 'USDC') return { ok: false, message: 'Por ahora solo se pide USDC.' };
  if (typeof p.amount !== 'number' || !Number.isFinite(p.amount)) return { ok: false, message: 'El monto no es válido.' };
  const amount = checkAmount(String(p.amount), 'USDC');
  if (!amount.ok) return { ok: false, message: amount.error };
  if (p.note !== undefined && p.note !== null && typeof p.note !== 'string') return { ok: false, message: 'La nota tiene que ser texto.' };
  const note = cleanNote(p.note) ?? undefined;
  return { ok: true, payment: { to, amount: Number(amount.amount), asset: 'USDC', ...(note ? { note } : {}) } };
}

/** Valida el texto de `share`: texto no vacío, dentro del límite de un mensaje. */
export function parseShareText(params: unknown): { ok: true; text: string } | { ok: false; message: string } {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return { ok: false, message: 'Falta el mensaje.' };
  const text = (params as Record<string, unknown>).text;
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, message: 'El mensaje está vacío.' };
  if (text.length > MESSAGE_MAX) return { ok: false, message: `El mensaje es muy largo (máximo ${MESSAGE_MAX} caracteres).` };
  return { ok: true, text: text.trim() };
}

/**
 * Qué hacer con un pedido de la app. No ejecuta nada: solo decide. El host nunca confía
 * en lo que la app diga de sí misma; los permisos salen del catálogo y de la conexión.
 */
export function decideRequest(message: Pick<MiniAppRequestMessage, 'method' | 'params'>, state: HostState): HostDecision {
  const method: string = message.method;
  if (!isKnownMethod(method)) return fail('invalid_params', 'Ese método no existe.');

  switch (method) {
    case 'ready':
      return { action: 'ready' };
    case 'close':
      return { action: 'close' };
    case 'connect':
      return connectionCovers(state.connection, state.appPermissions) ? { action: 'connected' } : { action: 'connect' };
    case 'getUser':
      if (!connectionCovers(state.connection, state.appPermissions)) return fail('not_connected', 'Conecta tu cuenta de Kosmovia primero.');
      return { action: 'user' };
    case 'requestPayment': {
      if (!connectionCovers(state.connection, state.appPermissions)) return fail('not_connected', 'Conecta tu cuenta de Kosmovia primero.');
      if (!state.appPermissions.includes('pagos') || !state.connection?.permissions.includes('pagos')) {
        return fail('permission_denied', 'Esta app no tiene permiso para pedir pagos.');
      }
      const parsed = parsePaymentRequest(message.params);
      if (!parsed.ok) return fail('invalid_params', parsed.message);
      return { action: 'pay', payment: parsed.payment };
    }
    case 'share': {
      if (!connectionCovers(state.connection, state.appPermissions)) return fail('not_connected', 'Conecta tu cuenta de Kosmovia primero.');
      if (!state.appPermissions.includes('mensajes') || !state.connection?.permissions.includes('mensajes')) {
        return fail('permission_denied', 'Esta app no tiene permiso para publicar mensajes.');
      }
      const parsed = parseShareText(message.params);
      if (!parsed.ok) return fail('invalid_params', parsed.message);
      if (!state.hasChannel) return fail('unknown', 'No hay un canal abierto donde publicar.');
      return { action: 'share', text: parsed.text };
    }
  }
}
