import * as pushRepo from "./db/push-repo.ts";
import type { NotificationPrefs, PushKind } from "./push-rules.ts";

/**
 * Envío de notificaciones push (Web Push con claves VAPID). Server-only.
 *
 * - Sin VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y VAPID_SUBJECT el push queda apagado:
 *   `notify` no hace nada (ni siquiera consulta la base) y la UI lo dice.
 * - `notify` NUNCA lanza: un fallo de push no rompe la acción que lo disparó.
 * - `fireAndForget` no bloquea la respuesta y le pone un tope de tiempo.
 */

export type PushEnv = Record<string, string | undefined>;

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** Las tres variables completas y con forma de clave; si no, null (push apagado). */
export function readVapid(env: PushEnv = process.env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = env.VAPID_SUBJECT?.trim() ?? "";
  if (!publicKey || !privateKey || !subject) return null;
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(publicKey) || !/^[A-Za-z0-9_-]{40,50}$/.test(privateKey)) return null;
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

export function pushConfigured(env: PushEnv = process.env): boolean {
  return readVapid(env) !== null;
}

export interface PushMessage {
  kind: PushKind;
  title: string;
  body: string;
  /** Ruta dentro de la app a la que lleva el toque. */
  url: string;
  /** Los avisos con la misma etiqueta se reemplazan en vez de apilarse. */
  tag?: string;
}

export interface SendError {
  statusCode?: number;
}

/** Lo que `notify` necesita de afuera; los tests pasan una versión falsa. */
export interface PushDeps {
  configured: () => boolean;
  getPrefs: (profileId: string) => Promise<NotificationPrefs>;
  subscriptionsOf: (profileId: string) => Promise<pushRepo.StoredSubscription[]>;
  removeDeadEndpoint: (endpoint: string) => Promise<void>;
  touchSubscription: (endpoint: string) => Promise<void>;
  send: (sub: pushRepo.StoredSubscription, payload: string) => Promise<void>;
}

const SEND_TIMEOUT_MS = 5_000;
const TTL_SECONDS = 60 * 60;

async function sendWithWebPush(sub: pushRepo.StoredSubscription, payload: string): Promise<void> {
  const vapid = readVapid();
  if (!vapid) throw new Error("push_not_configured");
  const mod = await import("web-push");
  const webpush = mod.default ?? mod;
  await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
    TTL: TTL_SECONDS,
    timeout: SEND_TIMEOUT_MS,
    urgency: "normal",
    vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
  });
}

export const defaultDeps: PushDeps = {
  configured: () => pushConfigured(),
  getPrefs: pushRepo.getPrefs,
  subscriptionsOf: pushRepo.subscriptionsOf,
  removeDeadEndpoint: pushRepo.removeDeadEndpoint,
  touchSubscription: pushRepo.touchSubscription,
  send: sendWithWebPush,
};

/** Solo rutas internas de la app (la notificación nunca lleva a otro sitio). */
function safeUrl(url: string): string {
  return url.startsWith("/") && !url.startsWith("//") ? url : "/plataforma";
}

/**
 * Avisa a `profileId` en todos sus dispositivos si su preferencia del tipo está activa.
 * Borra las suscripciones que el servicio de push da por muertas (404 / 410).
 * Devuelve cuántos envíos salieron bien. No lanza nunca.
 */
export async function notify(profileId: string, message: PushMessage, deps: PushDeps = defaultDeps): Promise<number> {
  try {
    if (!deps.configured()) return 0;
    const prefs = await deps.getPrefs(profileId);
    if (!prefs[message.kind]) return 0;
    const subs = await deps.subscriptionsOf(profileId);
    if (subs.length === 0) return 0;
    const payload = JSON.stringify({
      title: message.title.slice(0, 100),
      body: message.body.slice(0, 200),
      url: safeUrl(message.url),
      tag: message.tag,
      icon: "/icons/icon-192.png",
    });
    const results = await Promise.all(
      subs.map(async (sub) => {
        try {
          await deps.send(sub, payload);
          await deps.touchSubscription(sub.endpoint).catch(() => {});
          return true;
        } catch (err) {
          const status = (err as SendError | null)?.statusCode;
          if (status === 404 || status === 410) await deps.removeDeadEndpoint(sub.endpoint).catch(() => {});
          return false;
        }
      }),
    );
    return results.filter(Boolean).length;
  } catch {
    // Nada de push puede romper la acción que lo disparó. Sin detalles en el log.
    console.error("push.error");
    return 0;
  }
}

/** Corre `task` sin esperarla: la respuesta de la ruta no depende del push. Tope de tiempo y nunca lanza. */
export function fireAndForget(task: () => Promise<unknown>, timeoutMs = 10_000): void {
  if (!pushConfigured()) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  void Promise.race([Promise.resolve().then(task).then(() => undefined), timeout])
    .catch(() => {})
    .finally(() => {
      if (timer) clearTimeout(timer);
    });
}
