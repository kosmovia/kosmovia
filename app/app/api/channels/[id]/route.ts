import { parseChannelUpdate } from "../../../../lib/core/api-input.ts";
import { limitedResponse } from "../../../../lib/core/api-limits.ts";
import { failure, handled, json, readJsonBody, requireGate, type Params } from "../../../../lib/core/api-route.ts";
import * as repo from "../../../../lib/core/db/repo.ts";
import { isUuid } from "../../../../lib/core/ids.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/channels/[id] { topic }
 *
 * Owner y admin cambian el tema del canal (texto recortado, 0..200; vacío lo quita).
 * -> 200 { channel } | 400 invalid_input | 403 | 404
 */
export async function PATCH(request: Request, ctx: Params<{ id: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const channelId = (await ctx.params).id;
  if (!isUuid(channelId)) return failure(404, "Canal no encontrado.", "not_found");
  const limited = limitedResponse("communityManage", auth.session.profileId);
  if (limited) return limited;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const input = parseChannelUpdate(body.value);
  if (!input.ok) return failure(400, input.error, "invalid_input");

  return handled("PATCH /api/channels/:id", async () => {
    const result = await repo.updateChannelTopic(channelId, auth.session.profileId, input.value.topic);
    if (!result.ok) {
      if ("notFound" in result) return failure(404, "Canal no encontrado.", "not_found");
      return failure(result.denied.status, result.denied.error, result.denied.code);
    }
    return json({ channel: result.value });
  });
}

/**
 * DELETE /api/channels/[id] (api backend)
 *
 * Owner y admin borran el canal y sus mensajes. #general nunca se borra.
 * -> 200 { ok: true } | 400 general_protected | 403 | 404
 */
export async function DELETE(request: Request, ctx: Params<{ id: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const channelId = (await ctx.params).id;
  if (!isUuid(channelId)) return failure(404, "Canal no encontrado.", "not_found");
  const limited = limitedResponse("communityManage", auth.session.profileId);
  if (limited) return limited;

  return handled("DELETE /api/channels/:id", async () => {
    const result = await repo.deleteChannel(channelId, auth.session.profileId);
    if (!result.ok) {
      if ("notFound" in result) return failure(404, "Canal no encontrado.", "not_found");
      return failure(result.denied.status, result.denied.error, result.denied.code);
    }
    return json({ ok: true });
  });
}
