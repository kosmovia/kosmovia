import { isChannelType, type ChannelType } from "./authz.ts";
import { isAvatarStyle, isValidAvatarSeed } from "./avatar/generator.ts";
import { esCodigoValido } from "./avatar/kosmonautas.ts";
import { isUuid } from "./ids.ts";
import { fromHandle } from "./mappers.ts";
import { cleanMessage, communityNameError, slugError, USERNAME_RE } from "./validation.ts";

/**
 * Request-body and query validation for the REST routes of the "api" backend.
 * Pure. Every rule mirrors a CHECK of db/migrations/0001_stage_a.sql, so the
 * database stays a second line of defense and the user gets a precise message
 * instead of a generic one.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export const DISPLAY_NAME_MAX = 40;
export const BIO_MAX = 280;
export const DESCRIPTION_MAX = 280;
export const ICON_MAX = 16;
export const TOPIC_MAX = 200;
export const CHANNEL_NAME_RE = /^[a-z0-9-]{1,30}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Optional string field: undefined when absent, null when present but not a string. */
function optionalString(body: Record<string, unknown>, key: string): string | undefined | null {
  if (!(key in body) || body[key] === undefined) return undefined;
  return typeof body[key] === "string" ? (body[key] as string) : null;
}

export interface ProfileCreate {
  username: string;
  displayName: string;
  avatarSeed: string | null;
  avatarStyle: string | null;
}

export function parseProfileCreate(body: unknown): Parsed<ProfileCreate> {
  if (!isRecord(body)) return fail("Datos inválidos.");
  const rawUsername = optionalString(body, "username");
  if (typeof rawUsername !== "string") return fail("Revisa tu @usuario.");
  const username = fromHandle(rawUsername);
  if (!USERNAME_RE.test(username)) return fail("Revisa tu @usuario.");

  const displayName = optionalString(body, "displayName");
  if (displayName === null) return fail("Revisa tu nombre.");
  if ((displayName ?? "").trim().length > DISPLAY_NAME_MAX) {
    return fail(`El nombre debe tener ${DISPLAY_NAME_MAX} caracteres como máximo.`);
  }

  const seed = optionalString(body, "avatarSeed");
  if (seed === null || (seed !== undefined && !isValidAvatarSeed(seed))) return fail("Ese avatar no es válido. Elige otro.");
  const style = optionalString(body, "avatarStyle");
  if (style === null || (style !== undefined && !isAvatarStyle(style))) {
    return fail("Ese estilo de avatar no es válido. Elige otro.");
  }
  if (style === "kosmonauta" && !esCodigoValido(seed)) return fail("Ese avatar no es válido. Elige otro.");

  return {
    ok: true,
    value: { username, displayName: (displayName ?? "").trim(), avatarSeed: seed ?? null, avatarStyle: style ?? null },
  };
}

export interface ProfileUpdate {
  username?: string;
  displayName?: string;
  avatarSeed?: string;
  avatarStyle?: string;
  bio?: string;
}

/** A partial update of the caller's own profile. Anything beyond these five fields is ignored, never applied. */
export function parseProfileUpdate(body: unknown): Parsed<ProfileUpdate> {
  if (!isRecord(body)) return fail("Datos inválidos.");
  const out: ProfileUpdate = {};

  const username = optionalString(body, "username");
  if (username === null) return fail("Revisa tu @usuario.");
  if (username !== undefined) {
    const handle = fromHandle(username);
    if (!USERNAME_RE.test(handle)) return fail("Revisa tu @usuario.");
    out.username = handle;
  }

  const displayName = optionalString(body, "displayName");
  if (displayName === null) return fail("Revisa tu nombre.");
  if (displayName !== undefined) {
    if (displayName.trim().length > DISPLAY_NAME_MAX) return fail(`El nombre debe tener ${DISPLAY_NAME_MAX} caracteres como máximo.`);
    out.displayName = displayName.trim();
  }

  const seed = optionalString(body, "avatarSeed");
  if (seed === null || (seed !== undefined && !isValidAvatarSeed(seed))) return fail("Ese avatar no es válido. Elige otro.");
  if (seed !== undefined) out.avatarSeed = seed;

  const style = optionalString(body, "avatarStyle");
  if (style === null || (style !== undefined && !isAvatarStyle(style))) {
    return fail("Ese estilo de avatar no es válido. Elige otro.");
  }
  if (style !== undefined) out.avatarStyle = style;
  // Un Kosmonauta se guarda siempre con su código (estilo y semilla juntos).
  if (style === "kosmonauta" && !esCodigoValido(seed)) return fail("Ese avatar no es válido. Elige otro.");

  const bio = optionalString(body, "bio");
  if (bio === null) return fail("Revisa tu bio.");
  if (bio !== undefined) {
    if (bio.trim().length > BIO_MAX) return fail(`La bio debe tener ${BIO_MAX} caracteres como máximo.`);
    out.bio = bio.trim();
  }

  if (Object.keys(out).length === 0) return fail("No hay nada que cambiar.");
  return { ok: true, value: out };
}

export interface CommunityCreate {
  name: string;
  slug: string;
  description: string;
  icon: string;
}

export function parseCommunityCreate(body: unknown): Parsed<CommunityCreate> {
  if (!isRecord(body)) return fail("Datos inválidos.");
  const name = optionalString(body, "name");
  const slug = optionalString(body, "slug");
  const description = optionalString(body, "description");
  const icon = optionalString(body, "icon");
  if (typeof name !== "string") return fail("Escribe el nombre de la comunidad.");
  if (typeof slug !== "string") return fail("Escribe un enlace para la comunidad.");
  if (description === null || icon === null) return fail("Datos inválidos.");

  const cleanName = name.trim();
  const cleanSlug = slug.trim();
  const bad = communityNameError(cleanName) ?? slugError(cleanSlug);
  if (bad) return fail(bad);
  const cleanDescription = (description ?? "").trim();
  if (cleanDescription.length > DESCRIPTION_MAX) return fail(`La descripción debe tener ${DESCRIPTION_MAX} caracteres como máximo.`);
  const cleanIcon = (icon ?? "").trim();
  if (cleanIcon.length > ICON_MAX) return fail(`El ícono debe tener ${ICON_MAX} caracteres como máximo.`);
  return { ok: true, value: { name: cleanName, slug: cleanSlug, description: cleanDescription, icon: cleanIcon } };
}

export interface ChannelCreate {
  name: string;
  topic: string | null;
  type: ChannelType;
}

export function parseChannelCreate(body: unknown): Parsed<ChannelCreate> {
  if (!isRecord(body)) return fail("Datos inválidos.");
  const name = optionalString(body, "name");
  if (typeof name !== "string" || !CHANNEL_NAME_RE.test(name.trim())) {
    return fail("El nombre del canal: minúsculas, números y guiones (hasta 30).");
  }
  const topic = optionalString(body, "topic");
  if (topic === null) return fail("Datos inválidos.");
  const cleanTopic = topic?.trim() ?? "";
  if (cleanTopic.length > TOPIC_MAX) return fail(`El tema debe tener ${TOPIC_MAX} caracteres como máximo.`);
  const type = body.type === undefined ? "text" : body.type;
  if (!isChannelType(type)) return fail("Tipo de canal inválido.");
  return { ok: true, value: { name: name.trim(), topic: cleanTopic === "" ? null : cleanTopic, type } };
}

export function parseMessageCreate(body: unknown): Parsed<{ content: string }> {
  if (!isRecord(body) || typeof body.content !== "string") return fail("El mensaje debe tener entre 1 y 2000 caracteres.");
  const content = cleanMessage(body.content);
  if (!content) return fail("El mensaje debe tener entre 1 y 2000 caracteres.");
  return { ok: true, value: { content } };
}

export interface MessagesQuery {
  before?: string;
  after?: string;
  limit?: number;
}

/** `?before=<messageId>&after=<messageId>&limit=<1..100>`. Cursors are message ids (UUIDs) only. */
export function parseMessagesQuery(params: URLSearchParams): Parsed<MessagesQuery> {
  const before = params.get("before");
  const after = params.get("after");
  const limitRaw = params.get("limit");
  const out: MessagesQuery = {};
  if (before !== null && after !== null) return fail("Usa solo before o after, no los dos.");
  if (before !== null) {
    if (!isUuid(before)) return fail("El cursor before no es válido.");
    out.before = before;
  }
  if (after !== null) {
    if (!isUuid(after)) return fail("El cursor after no es válido.");
    out.after = after;
  }
  if (limitRaw !== null) {
    if (!/^\d{1,4}$/.test(limitRaw)) return fail("El límite no es válido.");
    out.limit = Number(limitRaw);
  }
  return { ok: true, value: out };
}

/** A community slug from a URL segment, or null when it can't be one. */
export function cleanSlugParam(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  return slugError(s) === null ? s : null;
}

export function cleanUsernameParam(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const s = fromHandle(decoded);
  return USERNAME_RE.test(s) ? s : null;
}
