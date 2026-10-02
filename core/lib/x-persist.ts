import { profileIdFromWallet } from "./ids.ts";
import { readJwtConfig, signVerifierJwt } from "./jwt.ts";

/**
 * Writes the result of a successful X verification to `profiles` WITHOUT the
 * service_role: through PostgREST, with a 2-minute ES256 token whose role is
 * `kosmovia_verifier` (see supabase/migrations/0002_hardening.sql and
 * supabase/README.md). That role can read `id, wallet` and update only
 * `x_handle, x_verified_at, trust_level` (never to level 2) on profiles.
 * Server-only.
 */

export type PersistResult =
  | { persisted: true }
  | { persisted: false; reason: "not_configured" | "no_profile" | "error" | "x_taken" };

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface PersistOptions {
  /** The wallet that survived signature verification. */
  wallet: string;
  handle: string;
  /** ISO timestamp. */
  verifiedAt: string;
  env?: Record<string, string | undefined>;
  /** Injected in tests: no real network. Defaults to global `fetch`. */
  fetcher?: Fetcher;
  now?: number;
  timeoutMs?: number;
}

export type PersistConfig =
  | { ok: true; baseUrl: string; anonKey: string; privateKeyPem: string; keyId: string }
  | { ok: false };

/** Supabase URL + anon key + JWT signing key, or `ok: false` when any is missing. */
export function readPersistConfig(env: Record<string, string | undefined> = process.env): PersistConfig {
  const baseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const jwt = readJwtConfig(env);
  if (!baseUrl || !anonKey || !jwt.ok) return { ok: false };
  return { ok: true, baseUrl, anonKey, privateKeyPem: jwt.privateKeyPem, keyId: jwt.keyId };
}

export async function persistXVerification(opts: PersistOptions): Promise<PersistResult> {
  const config = readPersistConfig(opts.env);
  if (!config.ok) return { persisted: false, reason: "not_configured" };

  let token: string;
  try {
    token = signVerifierJwt({ privateKeyPem: config.privateKeyPem, keyId: config.keyId, now: opts.now }).token;
  } catch {
    // A malformed key. Never echo it or the reason.
    console.error("x.persist reason=jwt_sign_failed");
    return { persisted: false, reason: "not_configured" };
  }

  const profileId = profileIdFromWallet(opts.wallet);
  // id AND wallet: the row must be the one this wallet owns.
  const url =
    `${config.baseUrl}/rest/v1/profiles` +
    `?id=eq.${encodeURIComponent(profileId)}&wallet=eq.${encodeURIComponent(opts.wallet)}&select=id`;
  const fetcher: Fetcher = opts.fetcher ?? ((u, init) => fetch(u, init));

  let res: Response;
  try {
    res = await fetcher(url, {
      method: "PATCH",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ x_handle: opts.handle, x_verified_at: opts.verifiedAt, trust_level: 1 }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
    });
  } catch {
    console.warn("x.persist.failed reason=unreachable");
    return { persisted: false, reason: "error" };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const pgCode = body && typeof body === "object" && !Array.isArray(body) ? (body as { code?: unknown }).code : undefined;

  // PostgREST answers 409 for a unique violation: the lower(x_handle) index.
  if (res.status === 409 || pgCode === "23505") return { persisted: false, reason: "x_taken" };

  if (!res.ok) {
    console.warn(`x.persist.failed status=${res.status} code=${typeof pgCode === "string" ? pgCode : "none"}`);
    return { persisted: false, reason: "error" };
  }
  // No row updated: no profile yet for this wallet (or it is not one the verifier may touch).
  if (!Array.isArray(body) || body.length === 0) return { persisted: false, reason: "no_profile" };
  return { persisted: true };
}
