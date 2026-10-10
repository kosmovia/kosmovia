import { cleanSlugParam } from "../../../../../../lib/core/api-input.ts";
import { limitedResponse } from "../../../../../../lib/core/api-limits.ts";
import { failure, handled, json, requireGate, type Params } from "../../../../../../lib/core/api-route.ts";
import * as academia from "../../../../../../lib/core/db/academia-repo.ts";
import * as repo from "../../../../../../lib/core/db/repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/communities/[slug]/academia/ranking (api backend)
 * The community's XP table (members only, 403 `not_member`): 50 XP per completed lesson, 100 per mission. Up to 50 people.
 * -> { ranking: Array<{ profile, xp, lessons_completed, missions_completed, badges: string[] }> }
 */
export async function GET(request: Request, ctx: Params<{ slug: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("academiaRead", auth.session.profileId);
  if (limited) return limited;
  const slug = cleanSlugParam((await ctx.params).slug);
  if (!slug) return failure(404, "Comunidad no encontrada.", "not_found");

  return handled("GET /api/communities/:slug/academia/ranking", async () => {
    const community = await repo.getCommunityBySlug(slug);
    if (!community) return failure(404, "Comunidad no encontrada.", "not_found");
    const result = await academia.academiaRanking(community.id, auth.session.profileId);
    if (!result.ok) return failure(result.denied.status, result.denied.error, result.denied.code);
    return json({ ranking: result.value });
  });
}
