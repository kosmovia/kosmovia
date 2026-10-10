import { limitedResponse } from "../../../../lib/core/api-limits.ts";
import { failure, handled, json, requireGate } from "../../../../lib/core/api-route.ts";
import * as miniapps from "../../../../lib/core/db/miniapps-repo.ts";
import * as repo from "../../../../lib/core/db/repo.ts";
import { parseAppId } from "../../../../lib/core/miniapps.ts";
import { pinFailure, pinFromBody, pinRouteEntry, pinSecret } from "../../../../lib/core/security-route.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/miniapps/connections (api backend)
 * Las mini-apps que la persona de la sesión tiene conectadas (solo las activas).
 * -> { connections: Array<{ appId, permissions, createdAt }> } (la más reciente primero)
 */
export async function GET(request: Request): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("securityRead", auth.session.profileId);
  if (limited) return limited;

  return handled("GET /api/miniapps/connections", async () => {
    return json({ connections: await miniapps.listConnections(auth.session.profileId) });
  });
}

/**
 * POST /api/miniapps/connections { appId, pin } (api backend)
 *
 * Conecta una mini-app: verifica el PIN de pagos (el mismo, con el mismo bloqueo
 * por intentos fallidos) y guarda la conexión con los permisos que el SERVIDOR le
 * da a esa app (lib/core/miniapps.ts); lo que el cliente crea que tiene la app no
 * cuenta. Si ya había una conexión activa, se renueva. Un cambio de PIN posterior
 * NO la revoca.
 *
 * -> 201 { connection: { appId, permissions, createdAt } }
 *    400 invalid_app | invalid_pin | 404 unknown_app
 *    409 no_pin | 422 wrong_pin { attemptsLeft } | 423 locked { lockedUntil }
 */
export async function POST(request: Request): Promise<Response> {
  const entry = await pinRouteEntry(request);
  if (!entry.ok) return entry.response;
  const { session, body } = entry.ctx;

  // Primero lo que no necesita la base: un appId inválido no gasta un intento del PIN.
  const app = parseAppId(body.appId);
  if (!app.ok) return failure(app.code === "unknown_app" ? 404 : 400, app.error, app.code);
  const pin = pinFromBody(body.pin);
  if (!pin.ok) return pin.response;

  const secret = pinSecret();
  return handled("POST /api/miniapps/connections", async () => {
    const outcome = await repo.checkPin(session.profileId, pin.pin, secret);
    if (!outcome.ok) return pinFailure(outcome);
    const connection = await miniapps.connectApp(session.profileId, app.appId, app.app.permissions, outcome.pinVersion);
    return json({ connection }, 201);
  });
}
