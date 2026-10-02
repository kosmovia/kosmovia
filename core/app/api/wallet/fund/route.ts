import { requireSignedAddress } from "../../../../lib/auth.ts";
import { POLLAR_SERVER_API } from "../../../../lib/pollar-config.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/wallet/fund
 *
 * Only for Pollar apps in DEFERRED funding mode: the G-address exists but has
 * no XLM reserve until our backend calls Pollar's `POST /v1/wallets/fund`
 * (documented at docs.pollar.xyz/docs/core-concepts/funding-modes). That call
 * needs POLLAR_SECRET_KEY, so it lives here and never in client code.
 *
 * The address funded is the one that survived signature verification, never one
 * sent in the body. Testnet only: any key that isn't `sec_testnet_` is refused.
 * See docs/POLLAR-NOTES.md (endpoint fund vs activate is not fully confirmed).
 */
export async function POST(request: Request): Promise<Response> {
  const auth = requireSignedAddress(request);
  if (!auth.ok) return auth.response;

  const secret = process.env.POLLAR_SECRET_KEY?.trim();
  if (!secret) {
    return Response.json(
      { error: "Falta configurar POLLAR_SECRET_KEY en el servidor.", code: "secret_missing" },
      { status: 503 },
    );
  }
  if (!secret.startsWith("sec_testnet_")) {
    return Response.json(
      { error: "Kosmovia solo funciona en testnet: se necesita una clave sec_testnet_.", code: "not_testnet" },
      { status: 503 },
    );
  }

  let res: Response;
  try {
    res = await fetch(`${POLLAR_SERVER_API}/v1/wallets/fund`, {
      method: "POST",
      headers: { "x-pollar-api-key": secret, "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey: auth.address }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return Response.json({ error: "No se pudo contactar a Pollar.", code: "pollar_unreachable" }, { status: 502 });
  }

  // 200 funded; 409 "already funded, safe to ignore".
  if (res.ok || res.status === 409) {
    return Response.json({ address: auth.address, funded: true, alreadyFunded: res.status === 409 });
  }
  if (res.status === 402) {
    return Response.json(
      { error: "La wallet de fondeo de la app no tiene XLM suficiente (cárgala con Friendbot).", code: "funding_wallet_empty" },
      { status: 503 },
    );
  }
  if (res.status === 404) {
    return Response.json(
      { error: "Esta dirección no es una wallet creada por la app en Pollar.", code: "not_app_wallet" },
      { status: 404 },
    );
  }
  return Response.json({ error: "Pollar no pudo activar la cuenta.", code: "pollar_error" }, { status: 502 });
}
