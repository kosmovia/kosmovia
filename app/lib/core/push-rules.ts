/**
 * Reglas puras de las notificaciones push: validar una suscripción y las
 * preferencias, y armar el texto de cada aviso. Sin red ni base de datos.
 * Lo usan las rutas /api/push/*, push.ts y los tests.
 */

export type PushKind = "payments" | "dms" | "mentions";
export const PUSH_KINDS: readonly PushKind[] = ["payments", "dms", "mentions"];

export type NotificationPrefs = { payments: boolean; dms: boolean; mentions: boolean };
export const DEFAULT_PREFS: NotificationPrefs = { payments: true, dms: true, mentions: true };

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export const MAX_ENDPOINT_LENGTH = 1000;
/** Dispositivos por perfil; al pasarse se borran los más viejos. */
export const MAX_SUBSCRIPTIONS_PER_PROFILE = 10;
export const MAX_MENTIONS_PER_MESSAGE = 10;
export const PREVIEW_MAX = 80;

/**
 * El servidor hace un POST a cada `endpoint`: solo se aceptan los servicios de push
 * de los navegadores (si no, quien llama podría hacer que el servidor pida cualquier URL).
 */
const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com", // Chrome, Edge, Brave, Opera y Android
  "push.services.mozilla.com", // Firefox
  "push.apple.com", // Safari y iPhone (web.push.apple.com)
  "notify.windows.com", // Edge en Windows (WNS)
] as const;

export function isAllowedPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_ENDPOINT_LENGTH || value.length < 20) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith("." + suffix));
}

const B64URL = /^[A-Za-z0-9_-]+$/;

/** El cuerpo es `PushSubscription.toJSON()`: `{ endpoint, keys: { p256dh, auth } }`. */
export function parsePushSubscription(value: unknown): { ok: true; value: PushSubscriptionInput } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  if (!value || typeof value !== "object") return bad("Suscripción inválida.");
  const v = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } | null };
  if (!isAllowedPushEndpoint(v.endpoint)) return bad("El endpoint de la suscripción no es válido.");
  const p256dh = v.keys?.p256dh;
  const auth = v.keys?.auth;
  if (typeof p256dh !== "string" || !B64URL.test(p256dh) || p256dh.length < 80 || p256dh.length > 100) {
    return bad("La clave p256dh no es válida.");
  }
  if (typeof auth !== "string" || !B64URL.test(auth) || auth.length < 16 || auth.length > 32) {
    return bad("La clave auth no es válida.");
  }
  return { ok: true, value: { endpoint: v.endpoint, p256dh, auth } };
}

export function parseEndpointBody(value: unknown): { ok: true; endpoint: string } | { ok: false; error: string } {
  const endpoint = value && typeof value === "object" ? (value as { endpoint?: unknown }).endpoint : undefined;
  if (typeof endpoint !== "string" || endpoint.length < 20 || endpoint.length > MAX_ENDPOINT_LENGTH) {
    return { ok: false, error: "Falta el endpoint." };
  }
  return { ok: true, endpoint };
}

/** Cualquier subconjunto de las tres preferencias; todas booleanas y al menos una. */
export function parsePrefsPatch(value: unknown): { ok: true; value: Partial<NotificationPrefs> } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Preferencias inválidas." };
  const out: Partial<NotificationPrefs> = {};
  for (const kind of PUSH_KINDS) {
    const v = (value as Record<string, unknown>)[kind];
    if (v === undefined) continue;
    if (typeof v !== "boolean") return { ok: false, error: "Cada preferencia debe ser verdadero o falso." };
    out[kind] = v;
  }
  if (Object.keys(out).length === 0) return { ok: false, error: "No hay nada que cambiar." };
  return { ok: true, value: out };
}

/** Un `user_agent` corto y sin caracteres de control. */
export function shortUserAgent(raw: string | null | undefined): string | null {
  // eslint-disable-next-line no-control-regex
  const clean = (raw ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120);
  return clean || null;
}

// ------------------------------------------------------------------ textos

/** "0.0100000" -> "0.01", "5.0000000" -> "5". */
export function formatAmount(amount: string): string {
  if (!amount.includes(".")) return amount;
  return amount.replace(/0+$/, "").replace(/\.$/, "");
}

export interface PushText {
  title: string;
  body: string;
}

export function paymentText(p: { amount: string; asset: string; fromUsername: string | null }): PushText {
  const who = p.fromUsername ? `@${p.fromUsername}` : "alguien";
  return { title: "Pago recibido", body: `Recibiste ${formatAmount(p.amount)} ${p.asset} de ${who}` };
}

export function dmText(fromUsername: string, content: string): PushText {
  const flat = content.replace(/\s+/g, " ").trim();
  const preview = flat.length > PREVIEW_MAX ? flat.slice(0, PREVIEW_MAX - 1).trimEnd() + "…" : flat;
  return { title: `@${fromUsername} te escribió`, body: preview };
}

export function mentionText(authorUsername: string, channelName: string): PushText {
  return { title: "Te mencionaron", body: `@${authorUsername} te mencionó en #${channelName}` };
}

// ---------------------------------------------------------------- menciones

const MENTION_RE = /(^|[^a-z0-9_])@([a-z0-9_]{3,20})(?![a-z0-9_])/gi;

/** Los @usuario distintos del texto, en minúsculas, en orden de aparición, hasta `max`. */
export function extractMentions(content: string, max = MAX_MENTIONS_PER_MESSAGE): string[] {
  const seen = new Set<string>();
  for (const match of content.matchAll(MENTION_RE)) {
    seen.add(match[2].toLowerCase());
    if (seen.size >= max) break;
  }
  return [...seen];
}

export interface MentionCandidate {
  id: string;
  username: string;
  /** Rol en la comunidad; null = no es miembro. */
  role: string | null;
}

/**
 * A quién avisar de una mención: miembros (no el autor) que pueden ver el canal.
 * Un canal privado lo ven owner, admin y moderator.
 */
export function pickMentionRecipients(
  candidates: readonly MentionCandidate[],
  ctx: { authorId: string; visibility: "public" | "private" },
  max = MAX_MENTIONS_PER_MESSAGE,
): MentionCandidate[] {
  const staff = new Set(["owner", "admin", "moderator"]);
  const seen = new Set<string>();
  const out: MentionCandidate[] = [];
  for (const c of candidates) {
    if (c.id === ctx.authorId || seen.has(c.id) || c.role === null) continue;
    if (ctx.visibility === "private" && !staff.has(c.role)) continue;
    seen.add(c.id);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}
