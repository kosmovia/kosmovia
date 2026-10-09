import { failure, handled, json } from "../../../../../lib/core/api-route.ts";
import * as repo from "../../../../../lib/core/db/repo.ts";
import { sessionIsFresh, validatePin } from "../../../../../lib/core/pin-rules.ts";
import { noContent, pinFailure, pinFromBody, pinRouteEntry, pinSecret } from "../../../../../lib/core/security-route.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/security/pin/reset { pin } (api backend)
 *
 * "Olvidé mi PIN". Como no se puede pedir el PIN viejo, se exige que la sesión
 * se haya emitido hace menos de 10 minutos (el `iat` de la cookie). Pero una
 * sesión robada recién emitida también cumpliría eso, así que el PIN nuevo NO
 * reemplaza al actual al instante: queda pendiente y se activa a las 24 horas.
 * Mientras tanto el PIN actual sigue valiendo, y con él se puede cancelar el reset
 * (DELETE de esta misma ruta). Al activarse sube la versión del PIN, borra el
 * bloqueo e invalida los permisos pendientes; los límites se conservan.
 * Quien todavía no tenía PIN lo recibe al instante.
 *
 * -> 204 (el primer PIN quedó activo)
 *    202 { pendingPinAt } (queda pendiente; ISO de cuándo se activa)
 *    400 invalid_pin | weak_pin
 *    403 reauth_required (la sesión es más vieja que 10 minutos: que vuelva a iniciar sesión)
 *    409 reset_pending { pendingPinAt } (ya hay un reset pendiente: no se pisa)
 */
export async function POST(request: Request): Promise<Response> {
  const entry = await pinRouteEntry(request);
  if (!entry.ok) return entry.response;
  const { session, body } = entry.ctx;

  const next = validatePin(body.pin);
  if (!next.ok) return failure(400, next.error, next.code);
  if (!sessionIsFresh(session.issuedAt, Date.now())) {
    return failure(403, "Para crear un PIN nuevo vuelve a iniciar sesión y hazlo enseguida.", "reauth_required");
  }

  const secret = pinSecret();
  return handled("POST /api/security/pin/reset", async () => {
    const outcome = await repo.requestPinReset(session.profileId, next.pin, secret);
    if (outcome.status === "created") return noContent();
    if (outcome.status === "pending") return json({ pendingPinAt: outcome.pendingPinAt }, 202);
    return json(
      {
        error: "Ya hay un cambio de PIN pendiente. Si fuiste tú, espera a que se active; si no, cancélalo con tu PIN actual.",
        code: "reset_pending",
        pendingPinAt: outcome.pendingPinAt,
      },
      409,
    );
  });
}

/**
 * DELETE /api/security/pin/reset { pin } (api backend)
 *
 * Cancela el cambio de PIN pendiente. Pide el PIN ACTUAL (cuenta como intento y
 * respeta el bloqueo): quien robó la sesión no lo sabe.
 *
 * -> 204 (también si no había nada pendiente)
 *    400 invalid_pin | 409 no_pin | 422 wrong_pin { attemptsLeft } | 423 locked { lockedUntil }
 */
export async function DELETE(request: Request): Promise<Response> {
  const entry = await pinRouteEntry(request);
  if (!entry.ok) return entry.response;
  const { session, body } = entry.ctx;

  const pin = pinFromBody(body.pin);
  if (!pin.ok) return pin.response;

  const secret = pinSecret();
  return handled("DELETE /api/security/pin/reset", async () => {
    const outcome = await repo.checkPin(session.profileId, pin.pin, secret);
    if (!outcome.ok) return pinFailure(outcome);
    await repo.cancelPinReset(session.profileId);
    return noContent();
  });
}
