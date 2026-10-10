import { failure, handled } from "../../../../lib/core/api-route.ts";
import * as repo from "../../../../lib/core/db/repo.ts";
import { validatePin } from "../../../../lib/core/pin-rules.ts";
import { noContent, pinChanged, pinFailure, pinFromBody, pinRouteEntry, pinSecret } from "../../../../lib/core/security-route.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/security/pin { pin, currentPin? } (api backend)
 *
 * Crea el PIN de pagos (6 dígitos, nada trivial como 123456 o 000000) o lo
 * cambia. Si ya hay un PIN, `currentPin` es obligatorio y cuenta como intento:
 * respeta el bloqueo por intentos fallidos igual que al pagar. Cambiar el PIN
 * sube su versión, cancela un "olvidé mi PIN" pendiente e invalida los permisos
 * de pago que estaban pendientes, todo en un solo paso.
 *
 * -> 204
 *    400 invalid_pin | weak_pin
 *    409 pin_exists (ya tiene PIN y no mandó currentPin) | pin_changed (el PIN cambió mientras tanto)
 *    422 wrong_pin { attemptsLeft } | 423 locked { lockedUntil }
 */
export async function PUT(request: Request): Promise<Response> {
  const entry = await pinRouteEntry(request);
  if (!entry.ok) return entry.response;
  const { session, body } = entry.ctx;

  const next = validatePin(body.pin);
  if (!next.ok) return failure(400, next.error, next.code);
  const hasCurrent = body.currentPin !== undefined && body.currentPin !== null;
  const current = hasCurrent ? pinFromBody(body.currentPin) : null;
  if (current && !current.ok) return current.response;

  const secret = pinSecret();
  return handled("PUT /api/security/pin", async () => {
    // Sin PIN todavía: se crea (y un currentPin que sobre se ignora).
    if (await repo.createPinHash(session.profileId, next.pin, secret)) return noContent();

    if (!current) return failure(409, "Ya tienes un PIN. Para cambiarlo escribe el actual.", "pin_exists");
    const outcome = await repo.checkPin(session.profileId, current.pin, secret);
    if (!outcome.ok) return pinFailure(outcome);
    // Solo si el PIN sigue siendo el que se acaba de verificar (misma versión).
    if (!(await repo.changePinHash(session.profileId, next.pin, secret, outcome.pinVersion))) return pinChanged();
    return noContent();
  });
}
