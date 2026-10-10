import { limitedResponse } from "../../../../lib/core/api-limits.ts";
import { failure, handled, json, readJsonBody, requireGate } from "../../../../lib/core/api-route.ts";
import * as pushRepo from "../../../../lib/core/db/push-repo.ts";
import { parsePrefsPatch } from "../../../../lib/core/push-rules.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/push/prefs -> { prefs: { payments, dms, mentions } } (sin fila guardada: todo activado) */
export async function GET(request: Request): Promise<Response> {
  const g = requireGate(request);
  if (!g.ok) return g.response;
  const limited = limitedResponse("pushRead", g.session.profileId);
  if (limited) return limited;
  return handled("GET /api/push/prefs", async () => json({ prefs: await pushRepo.getPrefs(g.session.profileId) }));
}

/** PUT /api/push/prefs { payments?, dms?, mentions? } -> { prefs } (mezcla con lo guardado) */
export async function PUT(request: Request): Promise<Response> {
  const g = requireGate(request);
  if (!g.ok) return g.response;
  const limited = limitedResponse("pushWrite", g.session.profileId);
  if (limited) return limited;

  const body = await readJsonBody(request, 512);
  if (!body.ok) return body.response;
  const patch = parsePrefsPatch(body.value);
  if (!patch.ok) return failure(400, patch.error, "invalid_input");

  return handled("PUT /api/push/prefs", async () => json({ prefs: await pushRepo.setPrefs(g.session.profileId, patch.value) }));
}
