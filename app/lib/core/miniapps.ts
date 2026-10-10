import type { MiniAppPermission } from "../miniapp-sdk/protocol.ts";

/**
 * Catálogo de mini-apps que el SERVIDOR conoce. Es la única fuente de verdad de
 * qué permisos tiene cada app: al conectar, el servidor guarda estos permisos y
 * nunca los que diga el cliente. Hoy solo hay apps oficiales; las de terceros
 * entrarán aquí (o en una tabla) cuando se aprueben.
 *
 * El registro de la interfaz (components/apps/registry.ts) agrega lo visual
 * (ícono, textos, url) y toma los permisos de aquí; tests/miniapps.test.mts
 * comprueba que no se separen.
 *
 * Ojo con lo que NO es una conexión: es el consentimiento de la persona ("esta
 * app puede pedirme X"), que el host de Kosmovia consulta. No mueve dinero ni
 * reemplaza al PIN: cada pago sigue pidiendo su permiso con PIN en el servidor.
 */

export interface ServerMiniApp {
  id: string;
  name: string;
  permissions: readonly MiniAppPermission[];
}

export const MINIAPP_CATALOG: readonly ServerMiniApp[] = [
  { id: "vaquita", name: "Vaquita", permissions: ["perfil", "pagos", "mensajes"] },
  { id: "retos", name: "Retos", permissions: ["perfil", "mensajes"] },
  { id: "aprende", name: "Aprende Stellar", permissions: ["perfil"] },
];

/** Forma de un id de app: minúsculas, números y guiones; empieza con letra. */
export const APP_ID_RE = /^[a-z][a-z0-9-]{1,31}$/;

export function findMiniApp(appId: string): ServerMiniApp | null {
  return MINIAPP_CATALOG.find((app) => app.id === appId) ?? null;
}

/** Los permisos que el servidor le da a `appId`, o null si no es una app conocida. */
export function serverPermissions(appId: string): MiniAppPermission[] | null {
  const app = findMiniApp(appId);
  return app ? [...app.permissions] : null;
}

export type AppIdCheck =
  | { ok: true; appId: string; app: ServerMiniApp }
  | { ok: false; code: "invalid_app" | "unknown_app"; error: string };

/** Valida el `appId` que llega en un pedido: formato primero, después que exista en el catálogo. */
export function parseAppId(value: unknown): AppIdCheck {
  if (typeof value !== "string" || !APP_ID_RE.test(value)) {
    return { ok: false, code: "invalid_app", error: "Indica qué app quieres conectar." };
  }
  const app = findMiniApp(value);
  if (!app) return { ok: false, code: "unknown_app", error: "Esa app no existe." };
  return { ok: true, appId: value, app };
}

/** Solo el formato (para desconectar: se puede revocar una app que ya salió del catálogo). */
export function isAppIdFormat(value: unknown): value is string {
  return typeof value === "string" && APP_ID_RE.test(value);
}

/** Una conexión tal como viaja por la API. */
export interface MiniAppConnectionWire {
  appId: string;
  permissions: MiniAppPermission[];
  /** ISO. */
  createdAt: string;
}
