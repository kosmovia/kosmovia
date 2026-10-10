import { cleanSlugParam } from "../../../../../lib/core/api-input.ts";
import { limitedResponse } from "../../../../../lib/core/api-limits.ts";
import { failure, handled, json, readJsonBody, requireGate, type Params } from "../../../../../lib/core/api-route.ts";
import * as repo from "../../../../../lib/core/db/repo.ts";
import * as retos from "../../../../../lib/core/db/retos-repo.ts";
import { parseRetoCreate } from "../../../../../lib/core/retos-rules.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/communities/[slug]/retos (api backend)
 * My retos in the community (members only, 403 `not_member`): the ones in play first, then the pending ones, then the latest finished.
 * Overdue ones are closed by time before listing (pending > 24 h -> expired; a game idle for 24 h goes to whoever did not abandon).
 * -> { retos: Array<{ id, community_id, game: "ttt"|"ppt", status, challenger, opponent, turn_profile_id, winner_id,
 *      created_at, updated_at, finished_at, expires_at, me: "challenger"|"opponent", your_turn, state }> }
 * `state` is what the caller may see: in "ppt" the opponent's pending move is never included.
 */
export async function GET(request: Request, ctx: Params<{ slug: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("retoRead", auth.session.profileId);
  if (limited) return limited;
  const slug = cleanSlugParam((await ctx.params).slug);
  if (!slug) return failure(404, "Comunidad no encontrada.", "not_found");

  return handled("GET /api/communities/:slug/retos", async () => {
    const community = await repo.getCommunityBySlug(slug);
    if (!community) return failure(404, "Comunidad no encontrada.", "not_found");
    const result = await retos.listMyRetos(community.id, auth.session.profileId);
    if (!result.ok) return failure(result.denied.status, result.denied.error, result.denied.code);
    return json({ retos: result.value });
  });
}

/**
 * POST /api/communities/[slug]/retos { game: "ttt"|"ppt", opponent: "@usuario" | id } (api backend)
 * Both people must be members. 201 { reto } | 400 invalid_input / self_challenge | 403 not_member | 404 opponent_not_found
 * | 409 already_open (one open reto per pair and game) | 422 opponent_not_member
 * | 429 quota_exceeded (10 pending per profile, 30 an hour).
 */
export async function POST(request: Request, ctx: Params<{ slug: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("retoCreate", auth.session.profileId);
  if (limited) return limited;
  const slug = cleanSlugParam((await ctx.params).slug);
  if (!slug) return failure(404, "Comunidad no encontrada.", "not_found");

  const body = await readJsonBody(request, 1_024);
  if (!body.ok) return body.response;
  const input = parseRetoCreate(body.value);
  if (!input.ok) return failure(400, input.error, "invalid_input");

  return handled("POST /api/communities/:slug/retos", async () => {
    const community = await repo.getCommunityBySlug(slug);
    if (!community) return failure(404, "Comunidad no encontrada.", "not_found");
    const result = await retos.createReto(community.id, auth.session.profileId, input.value);
    if (!result.ok) return failure(result.denied.status, result.denied.error, result.denied.code);
    return json({ reto: result.value }, 201);
  });
}
