import { limitedResponse } from "../../../../../lib/core/api-limits.ts";
import { failure, handled, json, requireGate, type Params } from "../../../../../lib/core/api-route.ts";
import * as retos from "../../../../../lib/core/db/retos-repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/retos/[id]/decline (api backend)
 * Only the person who was challenged (403 `not_opponent`), while the reto is pending (409 `not_pending`). -> { reto } with status "declined".
 */
export async function POST(request: Request, ctx: Params<{ id: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("retoAct", auth.session.profileId);
  if (limited) return limited;
  const { id } = await ctx.params;

  return handled("POST /api/retos/:id/decline", async () => {
    const result = await retos.declineRetoById(id, auth.session.profileId);
    if (!result.ok) return failure(result.denied.status, result.denied.error, result.denied.code);
    return json({ reto: result.value });
  });
}
