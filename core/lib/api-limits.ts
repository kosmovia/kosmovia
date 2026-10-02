import { createRateLimiter, takeAll, tooManyRequests, type RateLimiter } from "./rate-limit.ts";

/**
 * In-memory limits for the writes (and message polling) of the "api" backend.
 * Best-effort, per server instance (see rate-limit.ts); the hard caps on
 * messages, communities and channels are the triggers in the database.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const API_LIMITS = {
  profileWrite: { max: 20, windowMs: 10 * MINUTE },
  usernameSuggest: { max: 60, windowMs: 10 * MINUTE },
  communityCreate: { max: 10, windowMs: HOUR },
  communityJoin: { max: 60, windowMs: HOUR },
  channelCreate: { max: 20, windowMs: HOUR },
  messageSend: { max: 40, windowMs: MINUTE },
  /** Polling every 2.5 s is ~24 a minute per open tab. */
  messageRead: { max: 240, windowMs: MINUTE },
} as const;

export type LimitKind = keyof typeof API_LIMITS;

const limiters = Object.fromEntries(
  (Object.keys(API_LIMITS) as LimitKind[]).map((kind) => [kind, createRateLimiter(API_LIMITS[kind])]),
) as Record<LimitKind, RateLimiter>;

const MESSAGES: Record<LimitKind, string> = {
  profileWrite: "Demasiados cambios de perfil. Espera un momento e intenta de nuevo.",
  usernameSuggest: "Pediste muchas sugerencias seguidas. Espera un momento e intenta de nuevo.",
  communityCreate: "Creaste muchas comunidades seguidas. Espera un momento e intenta de nuevo.",
  communityJoin: "Demasiados intentos de unirte. Espera un momento e intenta de nuevo.",
  channelCreate: "Creaste muchos canales seguidos. Espera un momento e intenta de nuevo.",
  messageSend: "Vas muy rápido: espera un momento antes de enviar más mensajes.",
  messageRead: "Demasiadas consultas. Espera un momento.",
};

/** A 429 Response when `profileId` is over the limit for `kind`, else null (and the hit is recorded). */
export function limitedResponse(kind: LimitKind, profileId: string): Response | null {
  const denied = takeAll([[limiters[kind], profileId]]);
  return denied ? tooManyRequests(denied.retryAfterSeconds, MESSAGES[kind]) : null;
}

/** Test helper. */
export function resetApiLimits(): void {
  for (const limiter of Object.values(limiters)) limiter.clear();
}
