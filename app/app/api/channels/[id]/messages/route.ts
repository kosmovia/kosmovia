import { parseMessageCreate, parseMessagesQuery } from "../../../../../lib/core/api-input.ts";
import { limitedResponse } from "../../../../../lib/core/api-limits.ts";
import { failure, handled, json, readJsonBody, requireGate, type Params } from "../../../../../lib/core/api-route.ts";
import * as repo from "../../../../../lib/core/db/repo.ts";
import { isUuid } from "../../../../../lib/core/ids.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/channels/[id]/messages?before=<id>&after=<id>&limit=<1..100> (api backend)
 *
 * Members of the channel's community only (403 `not_member`). Oldest first,
 * each with its slim author. No cursor: the newest page (default 50).
 * `before`: the page older than that message. `after`: what came after it, for
 * polling; it reaches a few seconds back and the client dedupes by id.
 * -> { messages: Array<MessageRow & { author: AuthorRow }> }
 */
export async function GET(request: Request, ctx: Params<{ id: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const channelId = (await ctx.params).id;
  if (!isUuid(channelId)) return failure(404, "Canal no encontrado.", "not_found");

  const query = parseMessagesQuery(new URL(request.url).searchParams);
  if (!query.ok) return failure(400, query.error, "invalid_input");
  const limited = limitedResponse("messageRead", auth.session.profileId);
  if (limited) return limited;

  return handled("GET /api/channels/:id/messages", async () => {
    const result = await repo.listMessages(channelId, auth.session.profileId, query.value);
    if (!result.ok) {
      if ("notFound" in result) return failure(404, "Canal no encontrado.", "not_found");
      return failure(result.denied.status, result.denied.error, result.denied.code);
    }
    return json({ messages: result.value });
  });
}

/**
 * POST /api/channels/[id]/messages { content }
 *
 * The author is the session's profile, never the body's. Members post in `text`
 * channels; only owner/admin post in `announcement` ones (403
 * `announcement_readonly`). 201 { message }; 429 quota_exceeded (20 per minute,
 * 500 per hour).
 */
export async function POST(request: Request, ctx: Params<{ id: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const channelId = (await ctx.params).id;
  if (!isUuid(channelId)) return failure(404, "Canal no encontrado.", "not_found");
  const limited = limitedResponse("messageSend", auth.session.profileId);
  if (limited) return limited;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const input = parseMessageCreate(body.value);
  if (!input.ok) return failure(400, input.error, "invalid_input");

  return handled("POST /api/channels/:id/messages", async () => {
    const result = await repo.postMessage(channelId, auth.session.profileId, input.value.content);
    if (!result.ok) {
      if ("notFound" in result) return failure(404, "Canal no encontrado.", "not_found");
      return failure(result.denied.status, result.denied.error, result.denied.code);
    }
    return json({ message: result.value }, 201);
  });
}
