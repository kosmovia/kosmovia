import { parseMessageCreate, parseMessagesQuery } from "../../../../../lib/core/api-input.ts";
import { limitedResponse } from "../../../../../lib/core/api-limits.ts";
import { failure, handled, json, readJsonBody, requireGate, type Params } from "../../../../../lib/core/api-route.ts";
import * as repo from "../../../../../lib/core/db/repo.ts";
import { isUuid } from "../../../../../lib/core/ids.ts";
import { checkMarkers, previewText } from "../../../../../lib/core/attachments-rules.ts";
import * as attachments from "../../../../../lib/core/db/attachments-repo.ts";
import { notifyDm } from "../../../../../lib/core/push-triggers.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dms/[id]/messages?before=<id>&after=<id>&limit=<1..100>
 *
 * Mismos cursores que los mensajes de un canal. Solo las dos personas de la conversación
 * (para cualquier otra, 404). Marca la conversación como leída para quien llama.
 * -> { messages: Array<{ id, thread_id, channel_id (= thread_id), author_id, content, created_at,
 *      edited_at, author: { id, username, display_name, avatar_seed, avatar_style } }> }
 */
export async function GET(request: Request, ctx: Params<{ id: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const threadId = (await ctx.params).id;
  if (!isUuid(threadId)) return failure(404, "Conversación no encontrada.", "not_found");

  const query = parseMessagesQuery(new URL(request.url).searchParams);
  if (!query.ok) return failure(400, query.error, "invalid_input");
  const limited = limitedResponse("messageRead", auth.session.profileId);
  if (limited) return limited;

  return handled("GET /api/dms/:id/messages", async () => {
    const result = await repo.listDmMessages(threadId, auth.session.profileId, query.value);
    if (!result.ok) return failure(404, "Conversación no encontrada.", "not_found");
    return json({ messages: result.value });
  });
}

/**
 * POST /api/dms/[id]/messages { content }
 *
 * El autor es la sesión. Solo las dos personas de la conversación (para otra, 404).
 * Puede llevar hasta 4 marcadores `[ARCHIVO:<id>]` (ver POST /api/attachments): cada id tiene que ser
 * de quien escribe, de esta conversación y no estar usado (si no, 400 `attachment_invalid`).
 * -> 201 { message } | 400 invalid_input | 404 | 429
 */
export async function POST(request: Request, ctx: Params<{ id: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const threadId = (await ctx.params).id;
  if (!isUuid(threadId)) return failure(404, "Conversación no encontrada.", "not_found");
  const limited = limitedResponse("messageSend", auth.session.profileId);
  if (limited) return limited;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const input = parseMessageCreate(body.value);
  if (!input.ok) return failure(400, input.error, "invalid_input");
  const markers = checkMarkers(input.value.content);
  if (!markers.ok) return failure(400, markers.error, markers.code);

  return handled("POST /api/dms/:id/messages", async () => {
    const result =
      markers.ids.length === 0
        ? await repo.postDmMessage(threadId, auth.session.profileId, input.value.content)
        : await attachments.postDmMessageWithAttachments(threadId, auth.session.profileId, input.value.content, markers.ids);
    if (!result.ok) {
      if ("notFound" in result) return failure(404, "Conversación no encontrada.", "not_found");
      return failure(result.denied.status, result.denied.error, result.denied.code);
    }
    // El aviso push muestra "📎 Archivo", nunca el marcador crudo.
    notifyDm(threadId, auth.session.profileId, previewText(input.value.content));
    return json({ message: result.value }, 201);
  });
}
