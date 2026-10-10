import { limitedResponse } from "./api-limits.ts";
import { failure, json, readJsonBody, requireGate, type Session } from "./api-route.ts";
import type { PinOutcome } from "./db/repo.ts";
import { isPinFormat } from "./pin-rules.ts";
import { readSessionSecret } from "./session-cookie.ts";

/**
 * Piezas comunes de las rutas /api/security/*: la entrada de toda ruta con PIN
 * (sesión, freno por perfil, cuerpo JSON) y la respuesta a cada resultado de
 * verificar el PIN. Server-only.
 *
 * Códigos HTTP (la UI distingue por `code`, no por el número):
 *  - PIN incorrecto: 422, NO 401. El cliente (lib/core/api-client.ts) trata todo
 *    401 como "sesión vencida": refresca la sesión y REPITE el pedido, lo que
 *    gastaría un segundo intento del PIN sin que la persona lo sepa. Un 422 es
 *    "los datos que mandaste no son los correctos" y nadie lo reintenta.
 *  - Bloqueado: 423. Sin PIN / ya tiene PIN: 409. Límite diario: 403.
 */

export type PinRouteContext = { session: Session; body: Record<string, unknown> };

/** Sesión + freno por perfil + cuerpo JSON (objeto). Si falla, la respuesta ya está lista. */
export async function pinRouteEntry(
  request: Request,
  maxBytes = 1_024,
): Promise<{ ok: true; ctx: PinRouteContext } | { ok: false; response: Response }> {
  const g = requireGate(request);
  if (!g.ok) return g;
  const limited = limitedResponse("pinAttempt", g.session.profileId);
  if (limited) return { ok: false, response: limited };
  const body = await readJsonBody(request, maxBytes);
  if (!body.ok) return body;
  if (typeof body.value !== "object" || body.value === null || Array.isArray(body.value)) {
    return { ok: false, response: failure(400, "Se esperaba un objeto JSON.", "bad_json") };
  }
  return { ok: true, ctx: { session: g.session, body: body.value as Record<string, unknown> } };
}

/** SESSION_SECRET como bytes (el pepper del PIN). La puerta ya exigió que exista; esto es el cinturón. */
export function pinSecret(): Buffer {
  const secret = readSessionSecret();
  if (!secret) throw new Error("session_not_configured");
  return secret;
}

/** Un PIN que viene en el cuerpo, solo con el formato (verificar uno existente no exige que sea "fuerte"). */
export function pinFromBody(value: unknown): { ok: true; pin: string } | { ok: false; response: Response } {
  if (!isPinFormat(value)) return { ok: false, response: failure(400, "El PIN son exactamente 6 dígitos.", "invalid_pin") };
  return { ok: true, pin: value };
}

/** La respuesta a un PIN que no pasó. */
export function pinFailure(outcome: Exclude<PinOutcome, { ok: true }>): Response {
  if (outcome.reason === "no_pin") return failure(409, "Primero crea tu PIN de pagos.", "no_pin");
  if (outcome.reason === "locked") {
    return json({ error: "Demasiados intentos. Tu PIN está bloqueado por un rato.", code: "locked", lockedUntil: outcome.lockedUntil }, 423);
  }
  const left = outcome.attemptsLeft;
  const error = `PIN incorrecto. Te ${left === 1 ? "queda 1 intento" : `quedan ${left} intentos`}.`;
  return json({ error, code: "wrong_pin", attemptsLeft: left }, 422);
}

/** El PIN cambió entre la verificación y la acción (otro pedido, o un reset que se activó). */
export function pinChanged(): Response {
  return failure(409, "Tu PIN cambió mientras tanto. Vuelve a intentarlo con el PIN actual.", "pin_changed");
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
