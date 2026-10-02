import { requireSignedAddress } from "../../../../lib/auth.ts";
import { MIN_SECRET_LENGTH, verifyXPost, VERIFY_ERRORS } from "../../../../lib/x-verify.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Request bodies here are one short URL: anything bigger is refused. */
const MAX_BODY_BYTES = 2_048;

/**
 * POST /api/x/verify  { url }
 *
 * Checks the pasted X post through X's public oEmbed endpoint (no API key):
 * the author must own the handle in the URL and the text must hold this
 * wallet's current code. See lib/x-verify.ts for the URL and SSRF rules.
 *
 * Success: `{ handle, verifiedAt }`. Failure: `{ error, code }` with code one
 * of bad_url, not_found, code_missing, author_mismatch, x_unreachable.
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

  const result = await verifyXPost({ url, wallet: auth.address, secret });
  if (!result.ok) {
    console.warn(`x.verify.failed code=${result.code}`);
    return Response.json({ error: result.error, code: result.code }, { status: result.status });
  }

  // TODO(data-layer): persist here, as the signed wallet (auth.address), through
  // the Supabase layer: profiles.x_handle = result.handle,
  // profiles.x_verified_at = result.verifiedAt, profiles.trust_level = 1
  // (never lowering a higher level). Decide there whether one x_handle may be
  // claimed by several wallets (a unique index on lower(x_handle) says no).
  // Until then the result only lives in the browser for this visit.
  return Response.json({ handle: result.handle, verifiedAt: result.verifiedAt });
}
