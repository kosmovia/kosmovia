import { cleanUsernameParam } from "../../../../lib/core/api-input.ts";
import { failure, handled, json } from "../../../../lib/core/api-route.ts";
import * as repo from "../../../../lib/core/db/repo.ts";
import { ADDRESS_RE, PAYMENT_ASSETS, checkAmount, type PaymentAsset } from "../../../../lib/core/payments.ts";
import { pinChanged, pinFailure, pinFromBody, pinRouteEntry, pinSecret } from "../../../../lib/core/security-route.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `GABC…WXYZ`, igual que shortAddress del cliente. */
const shortAddress = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

/**
 * POST /api/security/approve { to, asset, amount, pin } (api backend)
 *
 * El paso previo a todo pago: verifica el PIN (con su bloqueo por intentos
 * fallidos), resuelve el destino (@usuario con o sin @, o una dirección G…; no
 * puede ser la propia wallet), revisa el monto con las mismas reglas de un pago
 * y el límite diario, y entrega un permiso de UN solo uso, atado a ese destino,
 * activo y monto, que vale 5 minutos y lleva una referencia (`memo`) que
 * genera el servidor: el pago tiene que firmarse con ESE memo, y solo así el permiso lo
 * respalda (un pago hecho antes del PIN no puede llevarla). `serverNow` es la hora de la
 * base, para medir cuánto le queda al permiso sin depender del reloj del navegador. El pago se firma después en el navegador
 * (Pollar) y al registrarlo en POST /api/payments se consume este permiso.
 *
 * -> 201 { id, toWallet, toLabel, asset, amount, expiresAt, serverNow, memo }
 *    400 invalid_recipient | invalid_amount | invalid_pin
 *    403 limit_exceeded { remaining }
 *    409 no_pin | pin_changed | 422 wrong_pin { attemptsLeft } | 423 locked { lockedUntil }
 */
export async function POST(request: Request): Promise<Response> {
  const entry = await pinRouteEntry(request);
  if (!entry.ok) return entry.response;
  const { session, body } = entry.ctx;

  const asset = body.asset as PaymentAsset;
  if (!PAYMENT_ASSETS.includes(asset)) return failure(400, "Elige USDC o XLM.", "invalid_amount");
  if (typeof body.amount !== "number" && typeof body.amount !== "string") {
    return failure(400, "Escribe un monto.", "invalid_amount");
  }
  const checked = checkAmount(String(body.amount), asset);
  if (!checked.ok) return failure(400, checked.error, "invalid_amount");

  if (typeof body.to !== "string") return failure(400, "Indica a quién le pagas.", "invalid_recipient");
  const pin = pinFromBody(body.pin);
  if (!pin.ok) return pin.response;

  const secret = pinSecret();
  return handled("POST /api/security/approve", async () => {
    // A quién: dirección G… o @usuario (con o sin @), igual que ApiWalletService.sendPayment.
    const raw = body.to as string;
    let toWallet: string;
    let toLabel: string;
    const asAddress = raw.trim().toUpperCase();
    if (ADDRESS_RE.test(asAddress)) {
      toWallet = asAddress;
      const owner = await repo.getProfileByWallet(asAddress);
      toLabel = owner ? `@${owner.username}` : shortAddress(asAddress);
    } else {
      const username = cleanUsernameParam(raw.trim());
      const profile = username ? await repo.getProfileByUsername(username) : null;
      if (!profile) return failure(400, "No encontramos a esa persona. Escribe su @usuario o una dirección G….", "invalid_recipient");
      toWallet = profile.wallet;
      toLabel = `@${profile.username}`;
    }
    if (toWallet === session.wallet) return failure(400, "No puedes enviarte a ti mismo.", "invalid_recipient");

    const outcome = await repo.checkPin(session.profileId, pin.pin, secret);
    if (!outcome.ok) return pinFailure(outcome);

    // El permiso se crea solo si el PIN sigue en la versión que se acaba de verificar.
    const approval = await repo.createApproval(session.profileId, { toWallet, asset, amount: checked.amount, pinVersion: outcome.pinVersion });
    if (!approval.ok) {
      if (approval.reason === "pin_changed") return pinChanged();
      return json(
        { error: "Con este pago pasarías tu límite diario.", code: "limit_exceeded", remaining: approval.remaining },
        403,
      );
    }
    return json(
      {
        id: approval.id,
        toWallet,
        toLabel,
        asset,
        amount: Number(checked.amount),
        expiresAt: approval.expiresAt,
        serverNow: approval.serverNow,
        memo: approval.memo,
      },
      201,
    );
  });
}
