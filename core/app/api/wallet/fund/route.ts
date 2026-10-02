import { requireSignedAddress } from "../../../../lib/auth.ts";
import { fundWallet } from "../../../../lib/fund.ts";
import { clientIp, tooManyRequests } from "../../../../lib/rate-limit.ts";

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
 *
 * Abuse guards (lib/fund.ts, in memory and best-effort): wallets already funded
 * are answered locally, concurrent calls for one wallet share one Pollar call,
 * and attempts are capped per wallet (3/hour) and per IP (10/hour) with a 429.
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

  const outcome = await fundWallet({ address: auth.address, ip: clientIp(request), secret });
  if (outcome.status === 429) {
    return tooManyRequests(outcome.retryAfterSeconds ?? 60, String(outcome.body.error));
  }
  return Response.json(outcome.body, { status: outcome.status });
}
