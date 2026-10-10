import { requireSession, isSecureContext, originAllowed, sessionClearCookie } from "../../../../lib/core/session-cookie.ts";

import { serverBackend } from "../../../../lib/core/backend.ts";
import { dbConfigured } from "../../../../lib/core/db/pool.ts";
import * as pushRepo from "../../../../lib/core/db/push-repo.ts";
import { readJsonBody } from "../../../../lib/core/api-route.ts";
import { isAllowedPushEndpoint } from "../../../../lib/core/push-rules.ts";

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
  let endpoint: string | undefined;
  if (request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    const body = await readJsonBody(request, 4_096);
    if (!body.ok) return body.response;
    const candidate = (body.value as { endpoint?: unknown } | null)?.endpoint;
    if (candidate !== undefined) {
      if (!isAllowedPushEndpoint(candidate)) return Response.json({ error: "Endpoint inválido.", code: "invalid_input" }, { status: 400 });
      endpoint = candidate;
    }
  }
  let pushDetached = endpoint === undefined;
  if (endpoint && serverBackend() === "api" && dbConfigured()) {
    const session = requireSession(request);
    if (session.ok) {
      try {
        // The authenticated profile and exact endpoint constrain deletion to this device.
        await pushRepo.removeSubscription(session.profileId, endpoint);
        pushDetached = true;
      } catch {
        console.error("auth.logout reason=push_detach_failed");
      }
    }
  }
  return Response.json(
    { ok: true, pushDetached },
    { headers: { "Cache-Control": "no-store", "Set-Cookie": sessionClearCookie(isSecureContext()) } },
  );
}
