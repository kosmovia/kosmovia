import { cleanSlugParam, parseChannelCreate } from "../../../../../lib/core/api-input.ts";
import { limitedResponse } from "../../../../../lib/core/api-limits.ts";
import { failure, handled, json, readJsonBody, requireGate, type Params } from "../../../../../lib/core/api-route.ts";
import * as repo from "../../../../../lib/core/db/repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/communities/[slug]/channels (api backend)
 * Members only (403 `not_member` otherwise). Private channels only for owner/admin/moderator.
 * -> { channels: Array<{ id, community_id, name, topic, type, category_id, position, visibility, emoji }>
 *      (by position, then creation), categories: Array<{ id, name, position }> (by position) }
 */
export async function GET(request: Request, ctx: Params<{ slug: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const slug = cleanSlugParam((await ctx.params).slug);
  if (!slug) return failure(404, "Comunidad no encontrada.", "not_found");

  return handled("GET /api/communities/:slug/channels", async () => {
    const community = await repo.getCommunityBySlug(slug);
    if (!community) return failure(404, "Comunidad no encontrada.", "not_found");
    const result = await repo.listChannels(community.id, auth.session.profileId);
    if (!result.ok) return failure(result.denied.status, result.denied.error, result.denied.code);
    const categories = result.value.categories.map(({ id, name, position }) => ({ id, name, position }));
    return json({ channels: result.value.channels, categories });
  });
}

/**
 * POST /api/communities/[slug]/channels { name, topic?, type?, emoji?, category_id?, visibility? }
 * Owner and admin only (403 `not_admin`). `category_id` must belong to the community
 * (400 `invalid_category`); `visibility` 'public' (default) | 'private'. 201 { channel }
 * (with category_id, position, visibility, emoji); 409 channel_taken;
 * 429 quota_exceeded (50 per community).
 */
export async function POST(request: Request, ctx: Params<{ slug: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("channelCreate", auth.session.profileId);
  if (limited) return limited;
  const slug = cleanSlugParam((await ctx.params).slug);
  if (!slug) return failure(404, "Comunidad no encontrada.", "not_found");

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const input = parseChannelCreate(body.value);
  if (!input.ok) return failure(400, input.error, "invalid_input");

  return handled("POST /api/communities/:slug/channels", async () => {
    const community = await repo.getCommunityBySlug(slug);
    if (!community) return failure(404, "Comunidad no encontrada.", "not_found");
    const result = await repo.createChannel(community.id, auth.session.profileId, input.value);
    if (!result.ok) return failure(result.denied.status, result.denied.error, result.denied.code);
    return json({ channel: result.value }, 201);
  });
}
