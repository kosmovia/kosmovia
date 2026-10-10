import { limitedResponse } from "../../../../../lib/core/api-limits.ts";
import { failure, handled, requireGate, type Params } from "../../../../../lib/core/api-route.ts";
import * as miniapps from "../../../../../lib/core/db/miniapps-repo.ts";
import { isAppIdFormat } from "../../../../../lib/core/miniapps.ts";
import { noContent } from "../../../../../lib/core/security-route.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/miniapps/connections/[appId] (api backend)
 *
 * Desconecta la mini-app: revoca la conexión activa de la persona de la sesión.
 * No pide PIN (quitar acceso nunca es riesgoso) y es idempotente: si no estaba
 * conectada, también responde 204. Sirve para apps que ya salieron del catálogo.
 *
 * -> 204
 *    400 invalid_app
 */
export async function DELETE(request: Request, ctx: Params<{ appId: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("securityRead", auth.session.profileId);
  if (limited) return limited;
  const { appId } = await ctx.params;
  if (!isAppIdFormat(appId)) return failure(400, "Indica qué app quieres desconectar.", "invalid_app");

  return handled("DELETE /api/miniapps/connections/:appId", async () => {
    await miniapps.revokeConnection(auth.session.profileId, appId);
    return noContent();
  });
}
