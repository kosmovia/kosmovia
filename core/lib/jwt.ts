import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";

/**
 * Supabase session JWT, ES256, signed with our own key (docs/ARQUITECTURA.md
 * section 2). Pure functions on node:crypto: no network, no Next.
 * Server-only.
 */

export const JWT_ISSUER = "kosmovia-core";
export const JWT_AUDIENCE = "authenticated";
export const JWT_TTL_SECONDS = 60 * 60;

export interface SessionClaims {
  sub: string;
  role: "authenticated";
  aud: string;
  wallet: string;
  iat: number;
  exp: number;
  iss: string;
}

export interface SignOptions {
  /** PEM (PKCS8 or SEC1) of the ES256 (P-256) private key. */
  privateKeyPem: string;
  /** Header `kid`: the key id registered in Supabase. */
  keyId: string;
  /** Profile id (UUID v5 of the wallet). */
  profileId: string;
  wallet: string;
  /** Epoch ms, injectable for tests. */
  now?: number;
  ttlSeconds?: number;
}

export interface SignedSession {
  token: string;
  /** Epoch ms. */
  expiresAt: number;
  claims: SessionClaims;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Env values often hold the PEM on one line with literal "\n". */
export function normalizePem(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
}

/** Header + claims -> compact ES256 JWS. Private: callers build the claims. */
function signCompact(claims: object, privateKeyPem: string, keyId: string): string {
  const header = { alg: "ES256", typ: "JWT", kid: keyId };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const key = createPrivateKey(normalizePem(privateKeyPem));
  // JWS wants raw r||s (IEEE P1363), not DER.
  const signature = sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64url(signature)}`;
}

export function signSessionJwt(opts: SignOptions): SignedSession {
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const claims: SessionClaims = {
    sub: opts.profileId,
    role: "authenticated",
    aud: JWT_AUDIENCE,
    wallet: opts.wallet,
    iat: nowSec,
    exp: nowSec + (opts.ttlSeconds ?? JWT_TTL_SECONDS),
    iss: JWT_ISSUER,
  };
  return {
    token: signCompact(claims, opts.privateKeyPem, opts.keyId),
    expiresAt: claims.exp * 1000,
    claims,
  };
}

// ----------------------------------------------------------------- verifier

/**
 * The Postgres role the server uses, and only the server, to write the result
 * of an X verification (supabase/migrations/0002_hardening.sql). It is NOT
 * `authenticated`: it can read profiles.id/wallet and update x_handle,
 * x_verified_at and trust_level (never to 2), nothing else. No service_role.
 */
export const VERIFIER_ROLE = "kosmovia_verifier";
export const VERIFIER_TTL_SECONDS = 2 * 60;
export const VERIFIER_SUB = "00000000-0000-0000-0000-000000000000";

export interface VerifierClaims {
  sub: string;
  role: typeof VERIFIER_ROLE;
  aud: string;
  iat: number;
  exp: number;
  iss: string;
}

export interface VerifierSignOptions {
  privateKeyPem: string;
  keyId: string;
  /** Epoch ms, injectable for tests. */
  now?: number;
  ttlSeconds?: number;
}

/** A 2-minute ES256 token with `role: kosmovia_verifier`, signed with the same key as the sessions. */
export function signVerifierJwt(opts: VerifierSignOptions): { token: string; expiresAt: number; claims: VerifierClaims } {
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const claims: VerifierClaims = {
    // Nil UUID: matches no profile, and still casts cleanly if a function reads `sub` as a uuid.
    sub: VERIFIER_SUB,
    role: VERIFIER_ROLE,
    aud: JWT_AUDIENCE,
    iat: nowSec,
    exp: nowSec + (opts.ttlSeconds ?? VERIFIER_TTL_SECONDS),
    iss: JWT_ISSUER,
  };
  return {
    token: signCompact(claims, opts.privateKeyPem, opts.keyId),
    expiresAt: claims.exp * 1000,
    claims,
  };
}

export type VerifyResult =
  | { ok: true; header: { alg: string; typ: string; kid: string }; claims: SessionClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "claims" };

/** Verifies a token we signed. Used by tests and any server code that needs to read it back. */
export function verifySessionJwt(token: string, publicKey: KeyObject | string, now = Date.now()): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as SessionClaims;
    if (header.alg !== "ES256") return { ok: false, reason: "malformed" };
    const key = typeof publicKey === "string" ? createPublicKey(normalizePem(publicKey)) : publicKey;
    const good = verify(
      "sha256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      { key, dsaEncoding: "ieee-p1363" },
      Buffer.from(parts[2], "base64url"),
    );
    if (!good) return { ok: false, reason: "bad_signature" };
    if (claims.exp * 1000 <= now) return { ok: false, reason: "expired" };
    if (claims.iss !== JWT_ISSUER || claims.aud !== JWT_AUDIENCE || claims.role !== "authenticated") {
      return { ok: false, reason: "claims" };
    }
    return { ok: true, header, claims };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

export type JwtConfig = { ok: true; privateKeyPem: string; keyId: string } | { ok: false };

/** Reads the signing config from env. `ok: false` when anything is missing. */
export function readJwtConfig(env: Record<string, string | undefined> = process.env): JwtConfig {
  const privateKeyPem = env.SUPABASE_JWT_PRIVATE_KEY?.trim();
  const keyId = env.SUPABASE_JWT_KEY_ID?.trim();
  if (!privateKeyPem || !keyId) return { ok: false };
  return { ok: true, privateKeyPem, keyId };
}
