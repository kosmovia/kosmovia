import { limitedResponse } from "../../../../lib/core/api-limits.ts";
import { failure, handled, json, readJsonBody, requireGate, type Params } from "../../../../lib/core/api-route.ts";
import * as repo from "../../../../lib/core/db/repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/vaquitas/[id] (api backend)
 * Members of its community only (403 `not_member`; 404 `not_found`).
 * -> { vaquita, contributions: Array<{ id, amount_usdc, tx_hash, created_at, contributor }> } (newest first)
 */
export async function GET(request: Request, ctx: Params<{ id: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("vaquitaRead", auth.session.profileId);
  if (limited) return limited;
  const { id } = await ctx.params;

  return handled("GET /api/vaquitas/:id", async () => {
    const result = await repo.getVaquitaDetail(id, auth.session.profileId);
    if (!result.ok) return failure(result.denied.status, result.denied.error, result.denied.code);
    return json(result.value);
  });
}

/**
 * PATCH /api/vaquitas/[id] { status: "closed" } (api backend)
 * Only who created it, or an owner/admin of the community (403 `forbidden`). Closing
 * one that is already closed answers the vaquita as it is. A closed vaquita does not reopen.
 * -> { vaquita }
 */
export async function PATCH(request: Request, ctx: Params<{ id: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("vaquitaManage", auth.session.profileId);
  if (limited) return limited;
  const { id } = await ctx.params;

  const body = await readJsonBody(request, 1_024);
  if (!body.ok) return body.response;
  const input = body.value as { status?: unknown } | null;
  if (typeof input !== "object" || input === null || input.status !== "closed") {
    return failure(400, "Solo se puede cambiar el estado a \"closed\".", "invalid_input");
  }

  return handled("PATCH /api/vaquitas/:id", async () => {
    const result = await repo.closeVaquita(id, auth.session.profileId);
    if (!result.ok) return failure(result.denied.status, result.denied.error, result.denied.code);
    return json({ vaquita: result.value });
  });
}
