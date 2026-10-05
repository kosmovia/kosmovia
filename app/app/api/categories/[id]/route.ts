import { parseCategoryUpdate } from "../../../../lib/core/api-input.ts";
import { limitedResponse } from "../../../../lib/core/api-limits.ts";
import { failure, handled, json, readJsonBody, requireGate, type Params } from "../../../../lib/core/api-route.ts";
import * as repo from "../../../../lib/core/db/repo.ts";
import { isUuid } from "../../../../lib/core/ids.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/categories/[id] { name?, position? }
 *
 * Owner y admin renombran (1..40) o reordenan (entero 0..1000) la categoría.
 * -> 200 { category: { id, name, position } } | 400 invalid_input | 403 not_admin / not_member | 404
 */
export async function PATCH(request: Request, ctx: Params<{ id: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const categoryId = (await ctx.params).id;
  if (!isUuid(categoryId)) return failure(404, "Categoría no encontrada.", "not_found");
  const limited = limitedResponse("communityManage", auth.session.profileId);
  if (limited) return limited;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const input = parseCategoryUpdate(body.value);
  if (!input.ok) return failure(400, input.error, "invalid_input");

  return handled("PATCH /api/categories/:id", async () => {
    const result = await repo.updateCategory(categoryId, auth.session.profileId, input.value);
    if (!result.ok) {
      if ("notFound" in result) return failure(404, "Categoría no encontrada.", "not_found");
      return failure(result.denied.status, result.denied.error, result.denied.code);
    }
    const { id, name, position } = result.value;
    return json({ category: { id, name, position } });
  });
}

/**
 * DELETE /api/categories/[id]
 *
 * Owner y admin borran la categoría; sus canales quedan sin categoría (category_id null).
 * -> 200 { ok: true } | 403 not_admin / not_member | 404
 */
export async function DELETE(request: Request, ctx: Params<{ id: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const categoryId = (await ctx.params).id;
  if (!isUuid(categoryId)) return failure(404, "Categoría no encontrada.", "not_found");
  const limited = limitedResponse("communityManage", auth.session.profileId);
  if (limited) return limited;

  return handled("DELETE /api/categories/:id", async () => {
    const result = await repo.removeCategory(categoryId, auth.session.profileId);
    if (!result.ok) {
      if ("notFound" in result) return failure(404, "Categoría no encontrada.", "not_found");
      return failure(result.denied.status, result.denied.error, result.denied.code);
    }
    return json({ ok: true });
  });
}
