import { cleanSlugParam, parseCategoryCreate } from "../../../../../lib/core/api-input.ts";
import { limitedResponse } from "../../../../../lib/core/api-limits.ts";
import { failure, handled, json, readJsonBody, requireGate, type Params } from "../../../../../lib/core/api-route.ts";
import * as repo from "../../../../../lib/core/db/repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/communities/[slug]/categories { name }
 *
 * Owner y admin crean una categoría de canales (nombre recortado, 1..40) al final de la lista.
 * -> 201 { category: { id, name, position } } | 400 invalid_input | 403 not_admin / not_member |
 *    404 | 429 (máximo 20 por comunidad)
 */
export async function POST(request: Request, ctx: Params<{ slug: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const slug = cleanSlugParam((await ctx.params).slug);
  if (!slug) return failure(404, "Comunidad no encontrada.", "not_found");
  const limited = limitedResponse("communityManage", auth.session.profileId);
  if (limited) return limited;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const input = parseCategoryCreate(body.value);
  if (!input.ok) return failure(400, input.error, "invalid_input");

  return handled("POST /api/communities/:slug/categories", async () => {
    const community = await repo.getCommunityBySlug(slug);
    if (!community) return failure(404, "Comunidad no encontrada.", "not_found");
    const result = await repo.createCategory(community.id, auth.session.profileId, input.value.name);
    if (!result.ok) return failure(result.denied.status, result.denied.error, result.denied.code);
    const { id, name, position } = result.value;
    return json({ category: { id, name, position } }, 201);
  });
}
