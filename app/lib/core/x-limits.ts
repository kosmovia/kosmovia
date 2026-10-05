import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";

/**
 * In-memory limits for the X routes (best-effort: per server instance, see
 * rate-limit.ts and docs/POLLAR-NOTES.md). /api/x/verify calls X's oEmbed, so
 * it is the tight one; /api/x/challenge is a stateless HMAC, so it is looser.
 */

const HOUR = 60 * 60 * 1000;

export const X_VERIFY_WALLET_LIMIT = 10;
export const X_VERIFY_IP_LIMIT = 30;
export const X_CHALLENGE_WALLET_LIMIT = 20;
export const X_CHALLENGE_IP_LIMIT = 60;

export interface XLimits {
  verifyWallet: RateLimiter;
  verifyIp: RateLimiter;
  challengeWallet: RateLimiter;
  challengeIp: RateLimiter;
}

export const xLimits: XLimits = {
  verifyWallet: createRateLimiter({ max: X_VERIFY_WALLET_LIMIT, windowMs: HOUR }),
  verifyIp: createRateLimiter({ max: X_VERIFY_IP_LIMIT, windowMs: HOUR }),
  challengeWallet: createRateLimiter({ max: X_CHALLENGE_WALLET_LIMIT, windowMs: HOUR }),
  challengeIp: createRateLimiter({ max: X_CHALLENGE_IP_LIMIT, windowMs: HOUR }),
};

/** Test helper. */
export function resetXLimits(): void {
  for (const limiter of Object.values(xLimits)) limiter.clear();
}
