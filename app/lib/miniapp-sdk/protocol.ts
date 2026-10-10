/**
 * Kosmovia Mini‑Apps · protocolo entre una mini‑app y Kosmovia (el "host").
 *
 * Una mini‑app corre aislada en un <iframe> dentro del panel Aplicaciones y solo
 * habla con Kosmovia por `postMessage`, con estos mensajes. Así una app de un
 * tercero nunca toca la wallet, el PIN ni la sesión: pide cosas y Kosmovia
 * decide, mostrando SIEMPRE su propia interfaz (conexión con PIN, confirmación
 * de pago con PIN).
 *
 * Hoy la única app es Vaquita (oficial). Más adelante, las apps de terceros
 * aprobadas se cargarán desde su propia URL con este mismo protocolo.
 */

export const KV_PROTOCOL = 'kosmovia-miniapp/1' as const;

/** Lo que una app puede pedir. El usuario lo acepta al conectar. */
export type MiniAppPermission = 'perfil' | 'pagos' | 'mensajes';

/** Perfil público que recibe la app (nunca la wallet completa ni datos privados). */
export interface MiniAppUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  /** Dirección G… pública: la app la necesita para mostrar a quién se paga. */
  wallet: string;
}

/** Dónde se abrió la app. */
export interface MiniAppContext {
  community: { id: string; slug: string; name: string } | null;
  channel: { id: string; name: string } | null;
  /** Tema visual del host, por si la app quiere adaptarse (puede ignorarlo). */
  theme: 'kosmovia' | 'negro';
  /** Parámetros con que se abrió (p. ej. `{ vaquitaId }` desde una tarjeta del chat). */
  params: Record<string, string>;
}

export interface ConnectResult {
  user: MiniAppUser;
  permissions: MiniAppPermission[];
}

export interface PaymentRequest {
  /** @usuario o dirección G…. */
  to: string;
  amount: number;
  asset: 'USDC';
  /** Texto corto que Kosmovia muestra en la confirmación (ej. "Aporte a Asado del sábado"). */
  note?: string;
}

export interface PaymentResult {
  /** Id del pago registrado en Kosmovia (sirve para vincularlo, p. ej. a una vaquita). */
  paymentId: string;
  txHash: string;
  amount: number;
  asset: 'USDC';
  toWallet: string;
}

/** Métodos que la app llama en el host, con sus parámetros y resultados. */
export interface MiniAppMethods {
  /** La app terminó de cargar: el host quita su pantalla de carga. */
  ready: { params: void; result: MiniAppContext };
  /** Pide conectar la wallet de Kosmovia. El host muestra permisos + PIN. */
  connect: { params: void; result: ConnectResult };
  /** Usuario conectado, o error `not_connected`. */
  getUser: { params: void; result: MiniAppUser };
  /** Pide un pago. El host muestra SU confirmación con PIN. Requiere permiso `pagos`. */
  requestPayment: { params: PaymentRequest; result: PaymentResult };
  /** Publica un mensaje en el canal activo, tras confirmarlo el usuario. Requiere `mensajes`. */
  share: { params: { text: string }; result: { messageId: string } };
  /** Cierra la app (vuelve a la lista de Aplicaciones). */
  close: { params: void; result: void };
}

export type MiniAppMethod = keyof MiniAppMethods;

export type MiniAppErrorCode =
  | 'not_in_kosmovia' // la app se abrió fuera de Kosmovia
  | 'not_connected' // hay que llamar a connect() primero
  | 'permission_denied' // la app no tiene ese permiso
  | 'user_rejected' // la persona canceló
  | 'invalid_params'
  | 'timeout'
  | 'unknown';

/** app → host */
export interface MiniAppRequestMessage<M extends MiniAppMethod = MiniAppMethod> {
  protocol: typeof KV_PROTOCOL;
  id: string;
  method: M;
  params: MiniAppMethods[M]['params'];
}

/** host → app */
export type MiniAppResponseMessage<M extends MiniAppMethod = MiniAppMethod> =
  | { protocol: typeof KV_PROTOCOL; id: string; ok: true; result: MiniAppMethods[M]['result'] }
  | { protocol: typeof KV_PROTOCOL; id: string; ok: false; error: { code: MiniAppErrorCode; message: string } };

export function isRequestMessage(data: unknown): data is MiniAppRequestMessage {
  const d = data as Partial<MiniAppRequestMessage> | null;
  return !!d && d.protocol === KV_PROTOCOL && typeof d.id === 'string' && typeof d.method === 'string';
}

export function isResponseMessage(data: unknown): data is MiniAppResponseMessage {
  const d = data as { protocol?: unknown; id?: unknown; ok?: unknown } | null;
  return !!d && d.protocol === KV_PROTOCOL && typeof d.id === 'string' && typeof d.ok === 'boolean';
}
