import { cleanSlugParam } from "../../../../../../lib/core/api-input.ts";
import { limitedResponse } from "../../../../../../lib/core/api-limits.ts";
import { failure, handled, json, requireGate, type Params } from "../../../../../../lib/core/api-route.ts";
import * as repo from "../../../../../../lib/core/db/repo.ts";
import * as retos from "../../../../../../lib/core/db/retos-repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/communities/[slug]/retos/ranking (api backend)
 * The community's table (members only, 403 `not_member`). Points come from finished retos only:
 * win 3, draw 1, loss 0 (no money involved). Up to 50 people, most points first.
 * -> { ranking: Array<{ profile, wins, draws, losses, points }> }
 */
export async function GET(request: Request, ctx: Params<{ slug: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("retoRead", auth.session.profileId);
  if (limited) return limited;
  const slug = cleanSlugParam((await ctx.params).slug);
  if (!slug) return failure(404, "Comunidad no encontrada.", "not_found");

  return handled("GET /api/communities/:slug/retos/ranking", async () => {
    const community = await repo.getCommunityBySlug(slug);
    if (!community) return failure(404, "Comunidad no encontrada.", "not_found");
    const result = await retos.retosRanking(community.id, auth.session.profileId);
    if (!result.ok) return failure(result.denied.status, result.denied.error, result.denied.code);
    return json({ ranking: result.value });
  });
}
