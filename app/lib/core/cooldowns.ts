// Cada cuánto se puede cambiar el @usuario y el Kosmonauta.
// La regla real está en la base (trigger profiles_change_cooldown); esto solo
// sirve para avisar en pantalla cuándo se podrá volver a cambiar.

const DAY_MS = 24 * 60 * 60 * 1000;

export const USERNAME_COOLDOWN_MS = DAY_MS;
export const AVATAR_COOLDOWN_MS = 3 * DAY_MS;

/** Fecha desde la que se puede volver a cambiar, o null si ya se puede. */
export function proximoCambio(changedAt: string | undefined | null, cooldownMs: number, now = Date.now()): Date | null {
  if (!changedAt) return null;
  const t = Date.parse(changedAt);
  if (Number.isNaN(t)) return null;
  const next = t + cooldownMs;
  return next > now ? new Date(next) : null;
}

export function fechaCorta(d: Date): string {
  return d.toLocaleString("es", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const COOLDOWN_MESSAGES: Record<string, string> = {
  username: "Ya cambiaste tu @usuario en las últimas 24 horas. Podrás cambiarlo de nuevo después.",
  avatar: "Ya cambiaste tu Kosmonauta en los últimos 3 días. Podrás cambiarlo de nuevo después.",
};

/** Mensaje en español para el error `cooldown:<campo>` del trigger, o null. */
export function cooldownMessage(error: { message?: string } | null | undefined): string | null {
  const found = /cooldown:([a-z_]+)/.exec(error?.message ?? "");
  if (!found) return null;
  return COOLDOWN_MESSAGES[found[1]] ?? "Ese cambio todavía no está disponible. Intenta más tarde.";
}
