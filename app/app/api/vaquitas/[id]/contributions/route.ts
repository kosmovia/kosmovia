import { limitedResponse } from "../../../../../lib/core/api-limits.ts";
import { failure, handled, json, readJsonBody, requireGate, type Params } from "../../../../../lib/core/api-route.ts";
import * as repo from "../../../../../lib/core/db/repo.ts";
import { isUuid } from "../../../../../lib/core/ids.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/vaquitas/[id]/contributions { paymentId } (api backend)
 *
 * Links a payment the session's wallet already recorded (POST /api/payments) to the
 * vaquita as a contribution. The money moved with that normal payment; this only
 * counts it. Everything is checked on the server with the stored payment, not the body:
 * it exists, the session's wallet sent it, to the creator's wallet, in USDC, it went
 * through the PIN (`unverified = false`), it is after the vaquita was created, and it
 * is not linked to any vaquita yet. The vaquita must be open and before its deadline.
 *
 * 201 { vaquita, contribution }
 * 403 not_member | own_vaquita, 404 not_found | payment_not_found,
 * 409 closed | already_linked, 422 payment_mismatch | payment_unverified
 */
export async function POST(request: Request, ctx: Params<{ id: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("vaquitaContribute", auth.session.profileId);
  if (limited) return limited;
  const { id } = await ctx.params;

  const body = await readJsonBody(request, 1_024);
  if (!body.ok) return body.response;
  const input = body.value as { paymentId?: unknown } | null;
  const paymentId = typeof input === "object" && input !== null && typeof input.paymentId === "string" ? input.paymentId.trim().toLowerCase() : "";
  if (!isUuid(paymentId)) return failure(400, "Falta el pago que quieres aportar.", "invalid_input");

  return handled("POST /api/vaquitas/:id/contributions", async () => {
    const result = await repo.contributeToVaquita(id, auth.session, paymentId);
    if (!result.ok) return failure(result.denied.status, result.denied.error, result.denied.code);
    return json(result.value, 201);
  });
}
