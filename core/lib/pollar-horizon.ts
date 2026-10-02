import { HORIZON_URL, USDC_CODE, USDC_ISSUER_TESTNET } from "./pollar-config.ts";

/** Balances as Horizon reports them: decimal strings with 7 places. Never converted to floats. */
export type AccountBalances = { exists: false } | { exists: true; xlm: string; usdc: string | null };

type HorizonBalance = {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
};

/** Reads XLM and USDC from Horizon testnet. A 404 means the account isn't on the network yet. */
export async function fetchBalances(address: string, signal?: AbortSignal): Promise<AccountBalances> {
  const res = await fetch(`${HORIZON_URL}/accounts/${encodeURIComponent(address)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  if (res.status === 404) return { exists: false };
  if (!res.ok) throw new Error(`Horizon respondió ${res.status}`);
  const body = (await res.json()) as { balances?: HorizonBalance[] };
  const balances = body.balances ?? [];
  const xlm = balances.find((b) => b.asset_type === "native")?.balance ?? "0.0000000";
  const usdc =
    balances.find((b) => b.asset_code === USDC_CODE && b.asset_issuer === USDC_ISSUER_TESTNET)
      ?.balance ?? null;
  return { exists: true, xlm, usdc };
}

/**
 * "1234.5600000" -> "1.234,56": groups thousands and trims trailing zeros by
 * string handling only, so no float ever touches an amount.
 */
export function formatAmount(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return value;
  const [, sign, whole, frac = ""] = match;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const trimmed = frac.replace(/0+$/, "");
  return `${sign}${grouped}${trimmed ? `,${trimmed}` : ""}`;
}

/** `GABC…WXYZ` for UI. */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

export type FriendbotResult = { ok: true } | { ok: false; message: string };

/** Testnet only: asks Friendbot (a public faucet) for test XLM. */
export async function requestFriendbot(address: string, friendbotUrl: string): Promise<FriendbotResult> {
  try {
    const res = await fetch(`${friendbotUrl}/?addr=${encodeURIComponent(address)}`);
    if (res.ok) return { ok: true };
    // Friendbot answers 400 when the account was already funded.
    const text = await res.text().catch(() => "");
    if (/already funded|op_already_exists|createAccountAlreadyExist/i.test(text)) {
      return {
        ok: false,
        message: "Esta cuenta ya recibió XLM de prueba. Si el saldo no aparece, actualiza en unos segundos.",
      };
    }
    return { ok: false, message: "Friendbot no pudo cargar la cuenta. Intenta de nuevo en un rato." };
  } catch {
    return { ok: false, message: "No se pudo contactar a Friendbot. Revisa tu conexión." };
  }
}
