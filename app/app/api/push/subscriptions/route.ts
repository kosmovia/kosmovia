import { limitedResponse } from "../../../../lib/core/api-limits.ts";
import { failure, handled, json, readJsonBody, requireGate } from "../../../../lib/core/api-route.ts";
import * as pushRepo from "../../../../lib/core/db/push-repo.ts";
import { pushConfigured } from "../../../../lib/core/push.ts";
import { parseEndpointBody, parsePushSubscription, shortUserAgent } from "../../../../lib/core/push-rules.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/push/subscriptions { endpoint, keys: { p256dh, auth } }
 *
 * Guarda o renueva la suscripción de este dispositivo (el cuerpo es `PushSubscription.toJSON()`).
 * Solo endpoints https de los servicios de push de los navegadores. Máximo 10 dispositivos por perfil.
 * -> 201 { ok: true } | 400 invalid_input | 503 push_not_configured
 */
export async function POST(request: Request): Promise<Response> {
  const g = requireGate(request);
  if (!g.ok) return g.response;
  const limited = limitedResponse("pushWrite", g.session.profileId);
  if (limited) return limited;
  if (!pushConfigured()) return failure(503, "Las notificaciones no están configuradas en el servidor.", "push_not_configured");

  const body = await readJsonBody(request, 4_096);
  if (!body.ok) return body.response;
  const expectedProfileId = (body.value as { expectedProfileId?: unknown } | null)?.expectedProfileId;
  if (expectedProfileId !== undefined && expectedProfileId !== g.session.profileId) {
    return failure(409, "La cuenta activa cambió. Vuelve a abrir Kosmovia.", "session_changed");
  }
  const sub = parsePushSubscription(body.value);
  if (!sub.ok) return failure(400, sub.error, "invalid_input");

  return handled("POST /api/push/subscriptions", async () => {
    await pushRepo.saveSubscription(g.session.profileId, {
      ...sub.value,
      userAgent: shortUserAgent(request.headers.get("user-agent")),
    });
    return json({ ok: true }, 201);
  });
}

/** DELETE /api/push/subscriptions { endpoint }: quita este dispositivo (solo si es del perfil de la sesión). */
export async function DELETE(request: Request): Promise<Response> {
  const g = requireGate(request);
  if (!g.ok) return g.response;
  const limited = limitedResponse("pushWrite", g.session.profileId);
  if (limited) return limited;

  const body = await readJsonBody(request, 4_096);
  if (!body.ok) return body.response;
  const parsed = parseEndpointBody(body.value);
  if (!parsed.ok) return failure(400, parsed.error, "invalid_input");

  return handled("DELETE /api/push/subscriptions", async () => {
    await pushRepo.removeSubscription(g.session.profileId, parsed.endpoint);
    return json({ ok: true });
  });
}
