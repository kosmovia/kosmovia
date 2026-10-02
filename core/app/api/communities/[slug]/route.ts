import { cleanSlugParam } from "../../../../lib/api-input.ts";
import { failure, gate, handled, json, type Params } from "../../../../lib/api-route.ts";
import * as repo from "../../../../lib/db/repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/communities/[slug] (api backend)
 *
 * The community is public (like the Supabase `communities_select_public`
 * policy); `myRole` is the caller's role in it, or null when anonymous or not a
 * member. -> { community: CommunityRow, myRole: "owner" | "admin" | "member" | null }
 */
export async function GET(request: Request, ctx: Params<{ slug: string }>): Promise<Response> {
  const g = gate(request, "optional");
  if (!g.ok) return g.response;
  const slug = cleanSlugParam((await ctx.params).slug);
  if (!slug) return failure(404, "Comunidad no encontrada.", "not_found");

  return handled("GET /api/communities/:slug", async () => {
    const community = await repo.getCommunityBySlug(slug);
    if (!community) return failure(404, "Comunidad no encontrada.", "not_found");
    const myRole = g.session ? await repo.getRole(community.id, g.session.profileId) : null;
    return json({ community, myRole });
  });
}
