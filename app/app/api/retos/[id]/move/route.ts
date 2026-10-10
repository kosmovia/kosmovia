import { limitedResponse } from "../../../../../lib/core/api-limits.ts";
import { failure, handled, json, readJsonBody, requireGate, type Params } from "../../../../../lib/core/api-route.ts";
import * as retos from "../../../../../lib/core/db/retos-repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/retos/[id]/move (api backend)
 * "ttt": { cell } with cell 0..8. "ppt": { choice: "piedra" | "papel" | "tijera" }.
 * The server checks the turn (409 `not_your_turn`), a free cell (409 `cell_taken`), a round not played yet
 * (409 `already_played`), the winner and the draw. 400 `invalid_move` for a move that does not fit the game,
 * 409 `not_active` / `expired`, 403 `not_player`. -> { reto }
 */
export async function POST(request: Request, ctx: Params<{ id: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("retoAct", auth.session.profileId);
  if (limited) return limited;
  const { id } = await ctx.params;

  const body = await readJsonBody(request, 1_024);
  if (!body.ok) return body.response;

  return handled("POST /api/retos/:id/move", async () => {
    const result = await retos.moveReto(id, auth.session.profileId, body.value);
    if (!result.ok) return failure(result.denied.status, result.denied.error, result.denied.code);
    return json({ reto: result.value });
  });
}
