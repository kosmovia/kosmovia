import { requireSignedAddress } from "../../../../lib/core/auth.ts";
import { serverBackend } from "../../../../lib/core/backend.ts";
import { dbErrorCode } from "../../../../lib/core/db/errors.ts";
import { dbConfigured } from "../../../../lib/core/db/pool.ts";
import * as repo from "../../../../lib/core/db/repo.ts";
import { profileIdFromWallet } from "../../../../lib/core/ids.ts";
import { clientIp, takeAll, tooManyRequests } from "../../../../lib/core/rate-limit.ts";
import { xLimits } from "../../../../lib/core/x-limits.ts";
import { persistXVerification, type PersistResult } from "../../../../lib/core/x-persist.ts";
import { MIN_SECRET_LENGTH, verifyXPost, VERIFY_ERRORS } from "../../../../lib/core/x-verify.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Request bodies here are one short URL: anything bigger is refused. */
const MAX_BODY_BYTES = 2_048;

const X_TAKEN_MESSAGE = "Esa cuenta de X ya está vinculada a otro perfil";

/**
 * POST /api/x/verify  { url }
 *
 * Checks the pasted X post through X's public oEmbed endpoint (no API key):
 * the author must own the handle in the URL and the text must hold this
 * wallet's current code. See lib/x-verify.ts for the URL and SSRF rules.
 *
 * On success it also writes `x_handle`, `x_verified_at` and `trust_level = 1`
 * to the caller's profile through the `kosmovia_verifier` role (lib/x-persist.ts,
 * no service_role). Success: `{ handle, verifiedAt, persisted }`, with
 * `persistReason` (no_profile | not_configured | error) when `persisted` is
 * false. A handle already linked to another profile answers 409 `x_taken`.
 * Failure: `{ error, code }` with code one of bad_url, not_found, code_missing,
 * author_mismatch, x_unreachable, rate_limited, x_taken.
 *
 * Limits (in memory, best-effort): 10/hour per wallet, 30/hour per IP.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = requireSignedAddress(request);
  if (!auth.ok) return auth.response;

  const secret = process.env.X_CHALLENGE_SECRET?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    return Response.json(
      { error: "Falta configurar X_CHALLENGE_SECRET en el servidor.", code: "secret_missing" },
      { status: 503 },
    );
  }

  let url: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) throw new Error("too large");
    url = (JSON.parse(raw) as { url?: unknown } | null)?.url;
  } catch {
    url = undefined;
  }
  if (typeof url !== "string") {
    return Response.json({ error: VERIFY_ERRORS.bad_url.error, code: "bad_url" }, { status: 400 });
  }

  // Only well-formed requests spend the budget, since only they reach X.
  const denied = takeAll([
    [xLimits.verifyWallet, auth.address],
    [xLimits.verifyIp, clientIp(request)],
  ]);
  if (denied) {
    return tooManyRequests(
      denied.retryAfterSeconds,
      "Demasiados intentos de verificar. Espera un momento e intenta de nuevo.",
    );
  }

  const result = await verifyXPost({ url, wallet: auth.address, secret });
  if (!result.ok) {
    console.warn(`x.verify.failed code=${result.code}`);
    return Response.json({ error: result.error, code: result.code }, { status: result.status });
  }

  const saved = await persistResult({ wallet: auth.address, handle: result.handle, verifiedAt: result.verifiedAt });
  if (saved.persisted) {
    return Response.json({ handle: result.handle, verifiedAt: result.verifiedAt, persisted: true });
  }
  if (saved.reason === "x_taken") {
    return Response.json({ error: X_TAKEN_MESSAGE, code: "x_taken" }, { status: 409 });
  }
  return Response.json({
    handle: result.handle,
    verifiedAt: result.verifiedAt,
    persisted: false,
    persistReason: saved.reason,
  });
}

/**
 * Where the verified account is saved: with KOSMOVIA_DATA_BACKEND=api straight
 * into Postgres through the repo (x_handle, x_verified_at, trust_level = 1,
 * never 2; a handle already taken is a unique violation -> x_taken); otherwise
 * through the Supabase `kosmovia_verifier` role.
 */
async function persistResult(opts: { wallet: string; handle: string; verifiedAt: string }): Promise<PersistResult> {
  if (serverBackend() !== "api") return persistXVerification(opts);
  if (!dbConfigured()) return { persisted: false, reason: "not_configured" };
  try {
    return await repo.persistXVerification({
      profileId: profileIdFromWallet(opts.wallet),
      wallet: opts.wallet,
      handle: opts.handle,
      verifiedAt: opts.verifiedAt,
    });
  } catch (err) {
    // 23505 on lower(x_handle): that X account belongs to another profile.
    if (dbErrorCode(err) === "23505") return { persisted: false, reason: "x_taken" };
    console.warn(`x.persist.failed backend=api code=${dbErrorCode(err)}`);
    return { persisted: false, reason: "error" };
  }
}
