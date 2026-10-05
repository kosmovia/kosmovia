import { isSecureContext, originAllowed, sessionClearCookie } from "../../../../lib/core/session-cookie.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout
 *
 * Clears the `kosmovia_session` cookie (api backend). It needs no proof: all it
 * can do is end the caller's own session. A cross-origin request is refused.
 * The cookie is stateless, so a copy stolen earlier stays valid until it
 * expires (12 hours): that is the price of not keeping a session table.
 */
export async function POST(request: Request): Promise<Response> {
  if (!originAllowed(request)) {
    return Response.json({ error: "Origen no permitido.", code: "bad_origin" }, { status: 403 });
  }
  return Response.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store", "Set-Cookie": sessionClearCookie(isSecureContext()) } },
  );
}
