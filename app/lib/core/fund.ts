import { POLLAR_SERVER_API } from "./pollar-config.ts";
import { createInFlight, createLruSet, createRateLimiter, takeAll, type RateLimiter } from "./rate-limit.ts";

/**
 * Funding through Pollar (`POST /v1/wallets/fund`), with in-memory abuse
 * guards in front (best-effort, see rate-limit.ts and docs/POLLAR-NOTES.md):
 *
 * 1. a wallet already funded (200/409) is remembered and answered locally;
 * 2. concurrent calls for the same wallet share one Pollar request;
 * 3. 3 attempts per hour per wallet and 10 per hour per IP.
 *
 * Server-only. Returns plain `{ status, body }` so deduped callers can each
 * build their own `Response`.
 */

export const FUND_WALLET_LIMIT = 3;
export const FUND_IP_LIMIT = 10;
export const FUND_WINDOW_MS = 60 * 60 * 1000;

export type FundOutcome = { status: number; body: Record<string, unknown>; retryAfterSeconds?: number };
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface FundGuards {
  wallet: RateLimiter;
  ip: RateLimiter;
}

export function createFundGuards(): FundGuards {
  return {
    wallet: createRateLimiter({ max: FUND_WALLET_LIMIT, windowMs: FUND_WINDOW_MS }),
    ip: createRateLimiter({ max: FUND_IP_LIMIT, windowMs: FUND_WINDOW_MS }),
  };
}

const defaultGuards = createFundGuards();
const fundedWallets = createLruSet(5_000);
const inFlight = createInFlight();

export interface FundOptions {
  address: string;
  ip: string;
  secret: string;
  /** Injected in tests: no real network. Defaults to global `fetch`. */
  fetcher?: Fetcher;
  guards?: FundGuards;
  now?: number;
}

/** Test helper: forget funded wallets. */
export function resetFundState(): void {
  fundedWallets.clear();
  defaultGuards.wallet.clear();
  defaultGuards.ip.clear();
}

export function fundWallet(opts: FundOptions): Promise<FundOutcome> {
  const { address } = opts;
  if (fundedWallets.has(address)) {
    return Promise.resolve({ status: 200, body: { address, funded: true, alreadyFunded: true } });
  }
  return inFlight.run(address, () => fundOnce(opts));
}

async function fundOnce(opts: FundOptions): Promise<FundOutcome> {
  const { address, ip, secret } = opts;
  const guards = opts.guards ?? defaultGuards;

  const denied = takeAll(
    [
      [guards.wallet, address],
      [guards.ip, ip],
    ],
    opts.now,
  );
  if (denied) {
    return {
      status: 429,
      retryAfterSeconds: denied.retryAfterSeconds,
      body: {
        error: "Demasiados intentos de activar la cuenta. Espera un momento y vuelve a intentar.",
        code: "rate_limited",
        retryAfterSeconds: denied.retryAfterSeconds,
      },
    };
  }

  const fetcher: Fetcher = opts.fetcher ?? ((url, init) => fetch(url, init));
  let res: Response;
  try {
    res = await fetcher(`${POLLAR_SERVER_API}/v1/wallets/fund`, {
      method: "POST",
      headers: { "x-pollar-api-key": secret, "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey: address }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { status: 502, body: { error: "No se pudo contactar a Pollar.", code: "pollar_unreachable" } };
  }

  // 200 funded; 409 "already funded, safe to ignore".
  if (res.ok || res.status === 409) {
    fundedWallets.add(address);
    return { status: 200, body: { address, funded: true, alreadyFunded: res.status === 409 } };
  }
  if (res.status === 402) {
    return {
      status: 503,
      body: {
        error: "La wallet de fondeo de la app no tiene XLM suficiente (cárgala con Friendbot).",
        code: "funding_wallet_empty",
      },
    };
  }
  if (res.status === 404) {
    return {
      status: 404,
      body: { error: "Esta dirección no es una wallet creada por la app en Pollar.", code: "not_app_wallet" },
    };
  }
  return { status: 502, body: { error: "Pollar no pudo activar la cuenta.", code: "pollar_error" } };
}
