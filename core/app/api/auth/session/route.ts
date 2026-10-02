import { requireSignedAddress } from "../../../../lib/auth.ts";
import { profileIdFromWallet } from "../../../../lib/ids.ts";
import { readJwtConfig, signSessionJwt } from "../../../../lib/jwt.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST /api/auth/session
 *
 * Verifies the SEP-53 proof in the `x-kosmovia-proof` header, then mints the
 * Supabase session JWT (ES256, 1 hour). `sub` is a UUID v5 of the wallet, so no
 * database lookup is needed and `profiles.id` uses that same id. The address
 * comes from the signature, never from the body.
 *
 * Without SUPABASE_JWT_PRIVATE_KEY / SUPABASE_JWT_KEY_ID it answers 503 with
 * code "supabase_not_configured" and still returns the verified address.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = requireSignedAddress(request);
  if (!auth.ok) return auth.response;

  const config = readJwtConfig();
  if (!config.ok) {
    return Response.json(
      {
        address: auth.address,
        error: "Falta configurar Supabase en el servidor: no se pudo emitir la sesión.",
        code: "supabase_not_configured",
      },
      { status: 503, headers: NO_STORE },
    );
  }

  const profileId = profileIdFromWallet(auth.address);
  try {
    const { token, expiresAt } = signSessionJwt({
      privateKeyPem: config.privateKeyPem,
      keyId: config.keyId,
      profileId,
      wallet: auth.address,
    });
    return Response.json({ address: auth.address, profileId, token, expiresAt }, { headers: NO_STORE });
  } catch {
    // A malformed key. Never echo it or the reason.
    console.error("auth.session reason=jwt_sign_failed");
    return Response.json(
      {
        address: auth.address,
        error: "No se pudo emitir la sesión. Revisa la clave de firma del servidor.",
        code: "supabase_not_configured",
      },
      { status: 503, headers: NO_STORE },
    );
  }
}
