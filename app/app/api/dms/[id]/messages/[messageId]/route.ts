import { parseMessageEdit } from "../../../../../../lib/core/api-input.ts";
import { limitedResponse } from "../../../../../../lib/core/api-limits.ts";
import { failure, handled, json, readJsonBody, requireGate, type Params } from "../../../../../../lib/core/api-route.ts";
import * as attachments from "../../../../../../lib/core/db/attachments-repo.ts";
import * as repo from "../../../../../../lib/core/db/repo.ts";
import { isUuid } from "../../../../../../lib/core/ids.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/dms/[id]/messages/[messageId] { content }
 *
 * Solo el autor edita su mensaje (1..2000 caracteres); guarda edited_at = now(). Los marcadores
 * `[ARCHIVO:<id>]` no se pueden quitar, agregar ni reordenar (400 `attachments_locked`).
 * -> 200 { message } | 400 invalid_input | 403 not_author | 404 | 429
 */
export async function PATCH(request: Request, ctx: Params<{ id: string; messageId: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const { id: threadId, messageId } = await ctx.params;
  if (!isUuid(threadId) || !isUuid(messageId)) return failure(404, "Mensaje no encontrado.", "not_found");
  const limited = limitedResponse("messageSend", auth.session.profileId);
  if (limited) return limited;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const input = parseMessageEdit(body.value);
  if (!input.ok) return failure(400, input.error, "invalid_input");

  return handled("PATCH /api/dms/:id/messages/:messageId", async () => {
    // Los archivos de un mensaje no se tocan al editar: los marcadores tienen que ser los mismos.
    if (!(await attachments.editKeepsMarkers({ scope: "dm", id: threadId }, messageId, auth.session.profileId, input.value.content))) {
      return failure(400, "Los archivos de un mensaje no se pueden quitar ni agregar al editarlo.", "attachments_locked");
    }
    const result = await repo.editDmMessage(threadId, messageId, auth.session.profileId, input.value.content);
    if (!result.ok) {
      if ("notFound" in result) return failure(404, "Mensaje no encontrado.", "not_found");
      return failure(result.denied.status, result.denied.error, result.denied.code);
    }
    return json({ message: result.value });
  });
}

/**
 * DELETE /api/dms/[id]/messages/[messageId]
 *
 * Solo el autor borra su mensaje (borrado definitivo).
 * -> 200 { ok: true } | 403 not_author | 404 | 429
 */
export async function DELETE(request: Request, ctx: Params<{ id: string; messageId: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const { id: threadId, messageId } = await ctx.params;
  if (!isUuid(threadId) || !isUuid(messageId)) return failure(404, "Mensaje no encontrado.", "not_found");
  const limited = limitedResponse("messageSend", auth.session.profileId);
  if (limited) return limited;

  return handled("DELETE /api/dms/:id/messages/:messageId", async () => {
    const result = await repo.removeDmMessage(threadId, messageId, auth.session.profileId);
    if (!result.ok) {
      if ("notFound" in result) return failure(404, "Mensaje no encontrado.", "not_found");
      return failure(result.denied.status, result.denied.error, result.denied.code);
    }
    return json({ ok: true });
  });
}
