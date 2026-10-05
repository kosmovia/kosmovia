import { cleanSlugParam, parseRoleChange } from "../../../../../../lib/core/api-input.ts";
import { limitedResponse } from "../../../../../../lib/core/api-limits.ts";
import { failure, handled, json, readJsonBody, requireGate, type Params } from "../../../../../../lib/core/api-route.ts";
import * as repo from "../../../../../../lib/core/db/repo.ts";
import { isUuid } from "../../../../../../lib/core/ids.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/communities/[slug]/members/[profileId] { role: "admin" | "moderator" | "member" } (api backend)
 *
 * El owner hace o quita admins y asigna moderator/member; un admin solo asigna
 * moderator/member a quien hoy lo es. El owner no se puede cambiar y 'owner'
 * no se asigna. -> 200 { member: { role, joined_at, profile } } | 400 | 403 | 404
 */
export async function PATCH(request: Request, ctx: Params<{ slug: string; profileId: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const params = await ctx.params;
  const slug = cleanSlugParam(params.slug);
  if (!slug) return failure(404, "Comunidad no encontrada.", "not_found");
  if (!isUuid(params.profileId)) return failure(400, "Esa persona no es válida.", "invalid_input");
  const limited = limitedResponse("communityManage", auth.session.profileId);
  if (limited) return limited;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const input = parseRoleChange(body.value);
  if (!input.ok) return failure(400, input.error, "invalid_input");

  return handled("PATCH /api/communities/:slug/members/:profileId", async () => {
    const community = await repo.getCommunityBySlug(slug);
    if (!community) return failure(404, "Comunidad no encontrada.", "not_found");
    const result = await repo.setMemberRole(community.id, auth.session.profileId, params.profileId.toLowerCase(), input.value.role);
    if (!result.ok) {
      if (result.denied.code === "target_not_member") return failure(404, result.denied.error, "not_found");
      return failure(result.denied.status, result.denied.error, result.denied.code);
    }
    return json({ member: result.value });
  });
}
