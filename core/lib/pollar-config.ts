/**
 * Pollar / Stellar settings shared by client and server. Kosmovia only runs on
 * testnet for now: the network is a constant, not something an env var can flip.
 */

export const NETWORK = "testnet" as const;

export const MISSING_KEY_MESSAGE = "Falta configurar Pollar (NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY)";

export const HORIZON_URL = "https://horizon-testnet.stellar.org";
export const FRIENDBOT_URL = "https://friendbot.stellar.org";
export const EXPLORER_BASE = "https://stellar.expert/explorer/testnet";
export const USDC_FAUCET_URL = "https://faucet.circle.com";

/** Circle's USDC on Stellar testnet. */
export const USDC_CODE = "USDC";
export const USDC_ISSUER_TESTNET = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/** Pollar backend used for the server-only funding call (see docs/POLLAR-NOTES.md). */
export const POLLAR_SERVER_API = "https://server.api.pollar.xyz";

export type KeyStatus =
  | { ok: true; key: string }
  | { ok: false; reason: "missing" | "mainnet"; message: string };

/** Reads the publishable key and refuses anything that isn't a testnet key. */
export function readPublishableKey(
  raw: string | undefined = process.env.NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY,
): KeyStatus {
  const key = raw?.trim();
  if (!key) return { ok: false, reason: "missing", message: MISSING_KEY_MESSAGE };
  if (key.startsWith("pub_mainnet_")) {
    return {
      ok: false,
      reason: "mainnet",
      message: "Kosmovia solo funciona en testnet: usa una clave pub_testnet_ de Pollar.",
    };
  }
  return { ok: true, key };
}

export function explorerAccountUrl(address: string): string {
  return `${EXPLORER_BASE}/account/${address}`;
}
