import { cleanSlugParam } from "../../../../../lib/api-input.ts";
import { failure, handled, json, requireGate, type Params } from "../../../../../lib/api-route.ts";
import * as repo from "../../../../../lib/db/repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/communities/[slug]/members (api backend)
 *
 * Members only: a non-member gets 403 `not_member`.
 * -> { members: [{ role, joined_at, profile: ProfileRow }] }
 */
export async function GET(request: Request, ctx: Params<{ slug: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const slug = cleanSlugParam((await ctx.params).slug);
  if (!slug) return failure(404, "Comunidad no encontrada.", "not_found");

  return handled("GET /api/communities/:slug/members", async () => {
    const community = await repo.getCommunityBySlug(slug);
    if (!community) return failure(404, "Comunidad no encontrada.", "not_found");
    const result = await repo.listMembers(community.id, auth.session.profileId);
    if (!result.ok) return failure(result.denied.status, result.denied.error, result.denied.code);
    return json({ members: result.value });
  });
}
