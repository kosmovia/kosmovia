import { parseDmOpen } from "../../../lib/core/api-input.ts";
import { limitedResponse } from "../../../lib/core/api-limits.ts";
import { failure, handled, json, readJsonBody, requireGate } from "../../../lib/core/api-route.ts";
import * as repo from "../../../lib/core/db/repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dms
 *
 * Las conversaciones directas de quien llama, la más reciente primero.
 * -> { threads: Array<{ id, other: { id, username, display_name, avatar_seed, avatar_style, wallet },
 *      last_message: { content, created_at, author_id } | null, unread: number, last_message_at }> }
 */
export async function GET(request: Request): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("messageRead", auth.session.profileId);
  if (limited) return limited;

  return handled("GET /api/dms", async () => json({ threads: await repo.listDmThreads(auth.session.profileId) }));
}

/**
 * POST /api/dms { username } | { profileId }
 *
 * Abre (o recupera) la conversación con otra persona. Solo si comparten al menos una comunidad.
 * -> 201 { thread } (nueva) | 200 { thread } (ya existía; mismo formato que GET) |
 *    400 invalid_input / self_dm | 403 no_shared_community | 404 not_found (perfil inexistente)
 */
export async function POST(request: Request): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("messageSend", auth.session.profileId);
  if (limited) return limited;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const input = parseDmOpen(body.value);
  if (!input.ok) return failure(400, input.error, "invalid_input");

  return handled("POST /api/dms", async () => {
    const other = input.value.profileId
      ? await repo.getProfileById(input.value.profileId)
      : await repo.getProfileByUsername(input.value.username as string);
    if (!other) return failure(404, "No encontramos a esa persona.", "not_found");
    const result = await repo.openDmThread(auth.session.profileId, other.id);
    if (!result.ok) return failure(result.denied.status, result.denied.error, result.denied.code);
    return json({ thread: result.value.thread }, result.value.created ? 201 : 200);
  });
}
