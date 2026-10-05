import { requireSignedAddress } from "../../../../lib/core/auth.ts";
import { serverBackend } from "../../../../lib/core/backend.ts";
import { profileIdFromWallet } from "../../../../lib/core/ids.ts";
import { readJwtConfig, signSessionJwt } from "../../../../lib/core/jwt.ts";
import {
  isSecureContext,
  readSessionSecret,
  requireSession,
  SESSION_TTL_SECONDS,
  sessionSetCookie,
  signSessionCookie,
} from "../../../../lib/core/session-cookie.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST /api/auth/session
 *
 * Verifies the SEP-53 proof in the `x-kosmovia-proof` header. The address comes
 * from the signature, never from the body. Then, by backend:
 *
 * - supabase (default): mints the Supabase session JWT (ES256, 1 hour) and
 *   returns it in the body. `sub` is a UUID v5 of the wallet, so no database
 *   lookup is needed. Without SUPABASE_JWT_PRIVATE_KEY / SUPABASE_JWT_KEY_ID it
 *   answers 503 "supabase_not_configured" and still returns the address.
 * - api (KOSMOVIA_DATA_BACKEND=api): sets the httpOnly `kosmovia_session`
 *   cookie (HS256, 12 hours, lib/session-cookie.ts) and returns
 *   `{ address, profileId, expiresAt, backend: "api" }`: no token in the body.
 *   Without SESSION_SECRET (32+ bytes) it answers 503 "session_not_configured".
 */
export async function POST(request: Request): Promise<Response> {
  const auth = requireSignedAddress(request);
  if (!auth.ok) return auth.response;

  if (serverBackend() === "api") return issueCookieSession(auth.address);

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

function issueCookieSession(address: string): Response {
  const secret = readSessionSecret();
  if (!secret) {
    return Response.json(
      {
        address,
        error: "Falta configurar SESSION_SECRET (32 caracteres o más) en el servidor: no se pudo emitir la sesión.",
        code: "session_not_configured",
      },
      { status: 503, headers: NO_STORE },
    );
  }
  const { token, expiresAt } = signSessionCookie({ secret, wallet: address });
  return Response.json(
    { address, profileId: profileIdFromWallet(address), expiresAt, backend: "api" },
    {
      headers: {
        ...NO_STORE,
        "Set-Cookie": sessionSetCookie(token, SESSION_TTL_SECONDS, isSecureContext()),
      },
    },
  );
}

/**
 * GET /api/auth/session (api backend only)
 *
 * Reads the cookie back: lets a page reload keep its session without asking the
 * wallet to sign again. 401 when there is no valid cookie.
 */
export async function GET(request: Request): Promise<Response> {
  if (serverBackend() !== "api") {
    return Response.json({ error: "No encontrado.", code: "backend_disabled" }, { status: 404, headers: NO_STORE });
  }
  const session = requireSession(request);
  if (!session.ok) return session.response;
  return Response.json(
    { address: session.wallet, profileId: session.profileId, expiresAt: session.expiresAt, backend: "api" },
    { headers: NO_STORE },
  );
}
