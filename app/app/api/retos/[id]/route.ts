import { limitedResponse } from "../../../../lib/core/api-limits.ts";
import { failure, handled, json, requireGate, type Params } from "../../../../lib/core/api-route.ts";
import * as retos from "../../../../lib/core/db/retos-repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/retos/[id] (api backend)
 * Only the two people playing (404 `not_found` for anyone else; 403 `not_member` if one left the community).
 * The client polls this every few seconds. -> { reto } (same shape as the list).
 * In "ppt" `state.current` has only the caller's move of the round in play and whether the other person already played;
 * the other person's move is revealed (in `state.rounds`) only once both played that round.
 */
export async function GET(request: Request, ctx: Params<{ id: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("retoRead", auth.session.profileId);
  if (limited) return limited;
  const { id } = await ctx.params;

  return handled("GET /api/retos/:id", async () => {
    const result = await retos.getReto(id, auth.session.profileId);
    if (!result.ok) return failure(result.denied.status, result.denied.error, result.denied.code);
    return json({ reto: result.value });
  });
}
