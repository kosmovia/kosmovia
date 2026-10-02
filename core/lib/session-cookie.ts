import { createHmac, timingSafeEqual } from "node:crypto";
import { isUuid, profileIdFromWallet } from "./ids.ts";

/**
 * Session for the "api" backend: an httpOnly cookie `kosmovia_session` holding
 * an HS256 JWT signed with SESSION_SECRET (node:crypto HMAC, no library).
 * Claims: sub = profile id (UUID v5 of the wallet), wallet, iat, exp (12 h).
 * It is minted by POST /api/auth/session only after a SEP-53 proof of the
 * wallet survived verification (lib/auth.ts). Server-only.
 *
 * Why this is safe to read back: only the HS256 algorithm is accepted (never
 * `none`, never another one), the MAC is compared in constant time, `exp` is
 * enforced, and `sub` must be exactly the id derived from `wallet`.
 *
 * Returns plain `Response`s so tests run under `node --test` without Next.
 */

export const SESSION_COOKIE = "kosmovia_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const MIN_SECRET_BYTES = 32;
/** Tolerated clock skew for `iat` (seconds). */
const IAT_SKEW_SECONDS = 60;

const G_ADDRESS = /^G[A-Z2-7]{55}$/;

export interface SessionCookieClaims {
  sub: string;
  wallet: string;
  iat: number;
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function mac(secret: Buffer, signingInput: string): Buffer {
  return createHmac("sha256", secret).update(signingInput).digest();
}

/** SESSION_SECRET as bytes, or null when it is missing or shorter than 32 bytes. */
export function readSessionSecret(env: Record<string, string | undefined> = process.env): Buffer | null {
  const raw = env.SESSION_SECRET;
  if (!raw) return null;
  const bytes = Buffer.from(raw, "utf8");
  return bytes.length >= MIN_SECRET_BYTES ? bytes : null;
}

export interface SignedCookie {
  token: string;
  /** Epoch ms. */
  expiresAt: number;
  claims: SessionCookieClaims;
}

export function signSessionCookie(opts: {
  secret: Buffer;
  wallet: string;
  /** Epoch ms, injectable for tests. */
  now?: number;
  ttlSeconds?: number;
}): SignedCookie {
  if (opts.secret.length < MIN_SECRET_BYTES) throw new Error("SESSION_SECRET too short");
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const claims: SessionCookieClaims = {
    sub: profileIdFromWallet(opts.wallet),
    wallet: opts.wallet,
    iat: nowSec,
    exp: nowSec + (opts.ttlSeconds ?? SESSION_TTL_SECONDS),
  };
  const signingInput = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
  return {
    token: `${signingInput}.${b64url(mac(opts.secret, signingInput))}`,
    expiresAt: claims.exp * 1000,
    claims,
  };
}

export type CookieVerify =
  | { ok: true; claims: SessionCookieClaims }
  | { ok: false; reason: "malformed" | "alg" | "bad_signature" | "expired" | "claims" };

export function verifySessionCookie(token: string, secret: Buffer, now = Date.now()): CookieVerify {
  if (secret.length < MIN_SECRET_BYTES) return { ok: false, reason: "bad_signature" };
  if (token.length > 2048) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) return { ok: false, reason: "malformed" };

  let header: unknown;
  let claims: unknown;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!header || typeof header !== "object" || !claims || typeof claims !== "object") {
    return { ok: false, reason: "malformed" };
  }
  // The algorithm comes from the token, so it is checked BEFORE trusting anything else.
  if ((header as { alg?: unknown }).alg !== "HS256") return { ok: false, reason: "alg" };

  const expected = mac(secret, `${parts[0]}.${parts[1]}`);
  const given = Buffer.from(parts[2], "base64url");
  // timingSafeEqual throws on different lengths: compare lengths first (they are public).
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  const c = claims as Partial<SessionCookieClaims>;
  if (typeof c.sub !== "string" || typeof c.wallet !== "string" || typeof c.exp !== "number" || typeof c.iat !== "number") {
    return { ok: false, reason: "claims" };
  }
  if (!Number.isFinite(c.exp) || !Number.isFinite(c.iat)) return { ok: false, reason: "claims" };
  if (c.exp * 1000 <= now) return { ok: false, reason: "expired" };
  if (c.iat * 1000 > now + IAT_SKEW_SECONDS * 1000) return { ok: false, reason: "claims" };
  if (!G_ADDRESS.test(c.wallet) || !isUuid(c.sub) || c.sub !== profileIdFromWallet(c.wallet)) {
    return { ok: false, reason: "claims" };
  }
  return { ok: true, claims: { sub: c.sub, wallet: c.wallet, iat: c.iat, exp: c.exp } };
}

// ------------------------------------------------------------------- cookies

/** `Secure` only in production: browsers refuse it on plain http, and `next dev` is http. */
export function isSecureContext(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "production";
}

function attributes(maxAge: number, secure: boolean): string {
  return `Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function sessionSetCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; ${attributes(maxAgeSeconds, secure)}`;
}

export function sessionClearCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; ${attributes(0, secure)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

/** Value of cookie `name` in a `Cookie:` header, or null. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

// ----------------------------------------------------------- request helper

export type SessionOutcome =
  | { ok: true; profileId: string; wallet: string; expiresAt: number }
  | { ok: false; response: Response };

function fail(status: number, error: string, code: string): SessionOutcome {
  return { ok: false, response: Response.json({ error, code }, { status, headers: { "Cache-Control": "no-store" } }) };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defense in depth on top of SameSite=Lax: a state-changing request that
 * names an `Origin` must name our own host. Requests with no Origin (curl,
 * scripts, same-origin GET navigations) pass; browsers always send it on
 * cross-site POSTs.
 */
export function originAllowed(request: Request): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  return originHost === host;
}

/**
 * Identity for the REST routes in "api" mode: the profile id and wallet of the
 * verified `kosmovia_session` cookie. 401 `session_required` / `session_expired`
 * / `session_invalid`, 403 `bad_origin`, 503 `session_not_configured`.
 * Never trusts an id or address sent in the body.
 */
export function requireSession(request: Request, env: Record<string, string | undefined> = process.env): SessionOutcome {
  if (!originAllowed(request)) return fail(403, "Origen no permitido.", "bad_origin");

  const secret = readSessionSecret(env);
  if (!secret) {
    return fail(503, "Falta configurar SESSION_SECRET (32 caracteres o más) en el servidor.", "session_not_configured");
  }
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return fail(401, "Falta iniciar sesión", "session_required");

  const result = verifySessionCookie(token, secret);
  if (!result.ok) {
    if (result.reason === "expired") return fail(401, "La sesión expiró. Vuelve a entrar.", "session_expired");
    console.warn(`session.rejected reason=${result.reason}`);
    return fail(401, "No se pudo verificar la sesión. Vuelve a entrar.", "session_invalid");
  }
  return { ok: true, profileId: result.claims.sub, wallet: result.claims.wallet, expiresAt: result.claims.exp * 1000 };
}
