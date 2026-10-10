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
  /** Each try asks Horizon; the client retries a pending payment a few times. */
  paymentRecord: { max: 60, windowMs: 10 * MINUTE },
  paymentRead: { max: 60, windowMs: MINUTE },
  /** Cambiar roles y borrar canales o comunidades: poco frecuente. */
  communityManage: { max: 60, windowMs: HOUR },
  /** Cada pedido que verifica o cambia el PIN. Es un freno extra: el bloqueo por intentos fallidos vive en la base. */
  pinAttempt: { max: 10, windowMs: MINUTE },
  securityRead: { max: 60, windowMs: MINUTE },
  /** Lista y detalle de vaquitas; el detalle se vuelve a pedir al ver la pantalla. */
  vaquitaRead: { max: 120, windowMs: MINUTE },
  vaquitaCreate: { max: 10, windowMs: HOUR },
  /** Cada pedido consulta la base y el pago; quien aporta lo hace pocas veces. */
  vaquitaContribute: { max: 30, windowMs: 10 * MINUTE },
  vaquitaManage: { max: 30, windowMs: HOUR },
  /** Subir o quitar un archivo adjunto (el tope duro de 30 por hora vive en un trigger). */
  attachmentWrite: { max: 20, windowMs: 10 * MINUTE },
  /** Cada miniatura del chat es una consulta; el navegador guarda la respuesta una hora. */
  attachmentRead: { max: 600, windowMs: MINUTE },
  /** Activar, renovar o quitar un dispositivo y cambiar los avisos. */
  pushWrite: { max: 30, windowMs: 10 * MINUTE },
  pushRead: { max: 60, windowMs: MINUTE },
  /** Retos: el cliente consulta cada pocos segundos (~20 por minuto por pestaña abierta). */
  retoRead: { max: 240, windowMs: MINUTE },
  retoCreate: { max: 30, windowMs: HOUR },
  /** Aceptar, rechazar y jugar. */
  retoAct: { max: 60, windowMs: MINUTE },
  academiaRead: { max: 120, windowMs: MINUTE },
  /** Cada envío corrige un cuestionario; se puede repetir, pero no a ráfagas. */
  academiaAnswer: { max: 30, windowMs: 10 * MINUTE },
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
  paymentRecord: "Registraste muchos pagos seguidos. Espera un momento e intenta de nuevo.",
  paymentRead: "Demasiadas consultas. Espera un momento.",
  communityManage: "Hiciste muchos cambios seguidos. Espera un momento e intenta de nuevo.",
  pinAttempt: "Demasiados intentos con el PIN. Espera un momento e intenta de nuevo.",
  securityRead: "Demasiadas consultas. Espera un momento.",
  vaquitaRead: "Demasiadas consultas. Espera un momento.",
  vaquitaCreate: "Creaste muchas vaquitas seguidas. Espera un momento e intenta de nuevo.",
  vaquitaContribute: "Intentaste vincular muchos aportes seguidos. Espera un momento e intenta de nuevo.",
  vaquitaManage: "Hiciste muchos cambios seguidos. Espera un momento e intenta de nuevo.",
  attachmentWrite: "Subiste muchos archivos seguidos. Espera un momento e intenta de nuevo.",
  attachmentRead: "Demasiadas consultas. Espera un momento.",
  pushWrite: "Hiciste muchos cambios de notificaciones seguidos. Espera un momento e intenta de nuevo.",
  pushRead: "Demasiadas consultas. Espera un momento.",
  retoRead: "Demasiadas consultas. Espera un momento.",
  retoCreate: "Creaste muchos retos seguidos. Espera un momento e intenta de nuevo.",
  retoAct: "Vas muy rápido. Espera un momento e intenta de nuevo.",
  academiaRead: "Demasiadas consultas. Espera un momento.",
  academiaAnswer: "Enviaste muchas respuestas seguidas. Espera un momento e intenta de nuevo.",
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
