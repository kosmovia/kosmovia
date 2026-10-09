import { failure, handled, json } from "../../../../lib/core/api-route.ts";
import * as repo from "../../../../lib/core/db/repo.ts";
import { parseDailyLimit } from "../../../../lib/core/pin-rules.ts";
import { pinChanged, pinFailure, pinFromBody, pinRouteEntry, pinSecret } from "../../../../lib/core/security-route.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/security/limits { USDC?, XLM?, pin } (api backend)
 *
 * Cambia el límite diario (24 h móviles) de uno o los dos activos. Pide el PIN
 * como al pagar (cuenta como intento y respeta el bloqueo). Cada límite: mayor
 * que 0 y hasta 100000, con hasta 7 decimales.
 *
 * -> 200 SecurityStatus (el estado ya actualizado)
 *    400 invalid_amount | invalid_pin
 *    409 no_pin | pin_changed | 422 wrong_pin { attemptsLeft } | 423 locked { lockedUntil }
 */
export async function PUT(request: Request): Promise<Response> {
  const entry = await pinRouteEntry(request);
  if (!entry.ok) return entry.response;
  const { session, body } = entry.ctx;

  const limits: { USDC?: string; XLM?: string } = {};
  for (const asset of ["USDC", "XLM"] as const) {
    if (body[asset] === undefined || body[asset] === null) continue;
    const parsed = parseDailyLimit(body[asset]);
    if (!parsed.ok) return failure(400, `${asset}: ${parsed.error}`, "invalid_amount");
    limits[asset] = parsed.amount;
  }
  if (limits.USDC === undefined && limits.XLM === undefined) {
    return failure(400, "Indica el límite de USDC, de XLM o de los dos.", "invalid_amount");
  }
  const pin = pinFromBody(body.pin);
  if (!pin.ok) return pin.response;

  const secret = pinSecret();
  return handled("PUT /api/security/limits", async () => {
    const outcome = await repo.checkPin(session.profileId, pin.pin, secret);
    if (!outcome.ok) return pinFailure(outcome);
    // Solo si el PIN sigue siendo el que se acaba de verificar (misma versión).
    if (!(await repo.updateDailyLimits(session.profileId, limits, outcome.pinVersion))) return pinChanged();
    return json(await repo.getSecurityStatus(session.profileId));
  });
}
