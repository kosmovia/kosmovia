import { cleanSlugParam } from "../../../../../lib/core/api-input.ts";
import { limitedResponse } from "../../../../../lib/core/api-limits.ts";
import { failure, handled, json, requireGate, type Params } from "../../../../../lib/core/api-route.ts";
import * as repo from "../../../../../lib/core/db/repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/communities/[slug]/join (api backend)
 *
 * The caller joins as `member`, always: a role is never taken from the request.
 * Joining twice is fine. -> { ok: true, role }. 404 unknown community,
 * 409 no_profile (create the profile first).
 */
export async function POST(request: Request, ctx: Params<{ slug: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("communityJoin", auth.session.profileId);
  if (limited) return limited;
  const slug = cleanSlugParam((await ctx.params).slug);
  if (!slug) return failure(404, "Comunidad no encontrada.", "not_found");

  return handled("POST /api/communities/:slug/join", async () => {
    const community = await repo.getCommunityBySlug(slug);
    if (!community) return failure(404, "Comunidad no encontrada.", "not_found");
    await repo.joinCommunity(community.id, auth.session.profileId);
    const role = await repo.getRole(community.id, auth.session.profileId);
    return json({ ok: true, role });
  });
}
