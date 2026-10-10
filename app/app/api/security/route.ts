import { limitedResponse } from "../../../lib/core/api-limits.ts";
import { handled, json, requireGate } from "../../../lib/core/api-route.ts";
import * as repo from "../../../lib/core/db/repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/security (api backend)
 *
 * El estado del PIN de pagos de la sesión: si ya tiene PIN, hasta cuándo está
 * bloqueado (si lo está), el límite diario por activo y lo ya aprobado en las
 * últimas 24 h. Nunca devuelve el hash ni la sal.
 * -> { hasPin, lockedUntil, dailyLimit: { USDC, XLM }, spentToday: { USDC, XLM } }
 */
export async function GET(request: Request): Promise<Response> {
  const g = requireGate(request);
  if (!g.ok) return g.response;
  const limited = limitedResponse("securityRead", g.session.profileId);
  if (limited) return limited;
  return handled("GET /api/security", async () => json(await repo.getSecurityStatus(g.session.profileId)));
}
