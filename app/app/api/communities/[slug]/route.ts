import { cleanSlugParam } from "../../../../lib/core/api-input.ts";
import { failure, gate, handled, json, readJsonBody, requireGate, type Params } from "../../../../lib/core/api-route.ts";
import { limitedResponse } from "../../../../lib/core/api-limits.ts";
import { checkCommunityImage } from "../../../../lib/core/community-image.ts";
import * as repo from "../../../../lib/core/db/repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/communities/[slug] (api backend)
 *
 * The community is public (like the Supabase `communities_select_public`
 * policy); `myRole` is the caller's role in it, or null when anonymous or not a
 * member. -> { community: CommunityRow, myRole: "owner" | "admin" | "moderator" | "member" | null }
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

/**
 * PATCH /api/communities/[slug] { image: dataUrl | null } (api backend)
 *
 * Solo el dueño cambia (o quita) la foto. La imagen se revisa por sus bytes.
 * -> { community } | 403 not_owner | 404
 */
export async function PATCH(request: Request, ctx: Params<{ slug: string }>): Promise<Response> {
  const g = requireGate(request);
  if (!g.ok) return g.response;
  const limited = limitedResponse("communityCreate", g.session.profileId);
  if (limited) return limited;
  const slug = cleanSlugParam((await ctx.params).slug);
  if (!slug) return failure(404, "Comunidad no encontrada.", "not_found");

  const body = await readJsonBody(request, 100_000);
  if (!body.ok) return body.response;
  const raw = (body.value ?? {}) as { image?: unknown };
  let image: string | null = null;
  if (raw.image !== null) {
    const checked = checkCommunityImage(raw.image);
    if (!checked.ok) return failure(400, checked.error, "invalid_input");
    image = checked.value;
  }

  return handled("PATCH /api/communities/:slug", async () => {
    const community = await repo.setCommunityImage(slug, g.session.profileId, image);
    if (community) return json({ community });
    const exists = await repo.getCommunityBySlug(slug);
    return exists
      ? failure(403, "Solo el dueño puede cambiar la foto de la comunidad.", "not_owner")
      : failure(404, "Comunidad no encontrada.", "not_found");
  });
}

/**
 * DELETE /api/communities/[slug] (api backend)
 *
 * Solo el dueño borra la comunidad; se van con ella sus miembros, canales y
 * mensajes (ON DELETE CASCADE). -> 200 { ok: true } | 403 not_owner | 404
 */
export async function DELETE(request: Request, ctx: Params<{ slug: string }>): Promise<Response> {
  const g = requireGate(request);
  if (!g.ok) return g.response;
  const slug = cleanSlugParam((await ctx.params).slug);
  if (!slug) return failure(404, "Comunidad no encontrada.", "not_found");
  const limited = limitedResponse("communityManage", g.session.profileId);
  if (limited) return limited;

  return handled("DELETE /api/communities/:slug", async () => {
    if (await repo.deleteCommunity(slug, g.session.profileId)) return json({ ok: true });
    const exists = await repo.getCommunityBySlug(slug);
    return exists
      ? failure(403, "Solo el dueño puede borrar la comunidad.", "not_owner")
      : failure(404, "Comunidad no encontrada.", "not_found");
  });
}
