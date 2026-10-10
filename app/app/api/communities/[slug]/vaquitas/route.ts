import { cleanSlugParam } from "../../../../../lib/core/api-input.ts";
import { limitedResponse } from "../../../../../lib/core/api-limits.ts";
import { failure, handled, json, readJsonBody, requireGate, type Params } from "../../../../../lib/core/api-route.ts";
import * as repo from "../../../../../lib/core/db/repo.ts";
import { parseVaquitaCreate } from "../../../../../lib/core/vaquita-rules.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/communities/[slug]/vaquitas (api backend)
 * Members only (403 `not_member`). Open ones first (newest on top), then the closed ones (most recently closed first).
 * -> { vaquitas: Array<{ id, community_id, title, description, goal_usdc, raised_usdc, contributors_count,
 *      deadline, status, created_at, closed_at, creator_wallet, creator }> }
 * Amounts are decimal strings with 7 places; `raised_usdc` and `contributors_count` are computed from the contributions.
 */
export async function GET(request: Request, ctx: Params<{ slug: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("vaquitaRead", auth.session.profileId);
  if (limited) return limited;
  const slug = cleanSlugParam((await ctx.params).slug);
  if (!slug) return failure(404, "Comunidad no encontrada.", "not_found");

  return handled("GET /api/communities/:slug/vaquitas", async () => {
    const community = await repo.getCommunityBySlug(slug);
    if (!community) return failure(404, "Comunidad no encontrada.", "not_found");
    const result = await repo.listVaquitas(community.id, auth.session.profileId);
    if (!result.ok) return failure(result.denied.status, result.denied.error, result.denied.code);
    return json({ vaquitas: result.value });
  });
}

/**
 * POST /api/communities/[slug]/vaquitas { title, description?, goalUsdc, deadline? } (api backend)
 * Any member. `title` 1..60, `description` up to 280, `goalUsdc` 0.01..100000 (USDC only),
 * `deadline` an ISO date in the future and at most one year away.
 * 201 { vaquita } | 400 invalid_input | 403 not_member | 429 quota_exceeded (20 open per community, 10 an hour per profile)
 */
export async function POST(request: Request, ctx: Params<{ slug: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("vaquitaCreate", auth.session.profileId);
  if (limited) return limited;
  const slug = cleanSlugParam((await ctx.params).slug);
  if (!slug) return failure(404, "Comunidad no encontrada.", "not_found");

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const input = parseVaquitaCreate(body.value, Date.now());
  if (!input.ok) return failure(400, input.error, "invalid_input");

  return handled("POST /api/communities/:slug/vaquitas", async () => {
    const community = await repo.getCommunityBySlug(slug);
    if (!community) return failure(404, "Comunidad no encontrada.", "not_found");
    const result = await repo.createVaquita(community.id, auth.session.profileId, input.value);
    if (!result.ok) return failure(result.denied.status, result.denied.error, result.denied.code);
    return json({ vaquita: result.value }, 201);
  });
}
