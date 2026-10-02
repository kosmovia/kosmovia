import { requireSignedAddress } from "../../../../lib/auth.ts";
import { challengeFor, MIN_SECRET_LENGTH } from "../../../../lib/x-verify.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/x/challenge
 *
 * Returns the code this wallet must post on X to prove it controls an account
 * (docs/ARQUITECTURA.md section 5). Stateless: the code is an HMAC of the
 * signed wallet and a 24h time bucket, so nothing is stored. The wallet is the
 * one that survived signature verification, never one sent in the body.
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

  return Response.json(challengeFor(secret, auth.address, Date.now()), {
    headers: { "Cache-Control": "no-store" },
  });
}
