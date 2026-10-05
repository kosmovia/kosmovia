/**
 * Welcome gift decisions, kept out of the component so they can be tested
 * without React or the network (pattern from Pollar Pass, lib/welcome.ts).
 */

export type Rule = { id: string; assetCode: string; amount: string; claimable: boolean };
/** A claimable USDC rule first (it pays for things), else any claimable one. */
export function pickWelcomeRule<T extends Rule>(rules: readonly T[]): T | null {
  const open = rules.filter((r) => r.claimable);
  return open.find((r) => r.assetCode === "USDC") ?? open[0] ?? null;
}

const GONE = new Set([
  "DISTRIBUTION_RULE_NOT_FOUND",
  "DISTRIBUTION_RULE_DISABLED",
  "DISTRIBUTION_RULE_NOT_STARTED",
  "DISTRIBUTION_RULE_EXPIRED",
  "DISTRIBUTION_RULE_EXHAUSTED",
  "DISTRIBUTION_NO_DISTRIBUTION_WALLET",
  "DISTRIBUTION_ASSET_NOT_ENABLED",
]);

/** The SDK throws `new Error(code)`: already claimed, gone for everyone, or worth a retry. */
export function claimFailure(err: unknown): "claimed" | "gone" | "retry" {
  const code = err instanceof Error ? err.message.trim() : "";
  if (code === "DISTRIBUTION_RATE_LIMIT_EXCEEDED") return "claimed";
  return GONE.has(code) ? "gone" : "retry";
}
