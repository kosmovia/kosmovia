/** Pure validators shared by the forms and the hooks. They mirror the CHECKs in supabase/migrations/0001_stage_a.sql. */

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MIN = 3;
export const SLUG_MAX = 40;
export const MESSAGE_MAX = 2000;

export function usernameError(value: string): string | null {
  if (value.length === 0) return "Escribe tu @usuario.";
  if (!/^[a-z0-9_]*$/.test(value)) return "Solo minúsculas, números y guion bajo.";
  if (value.length < 3) return "Debe tener al menos 3 caracteres.";
  if (value.length > 20) return "Debe tener 20 caracteres como máximo.";
  return null;
}

/** "Mi Comunidad Ñandú!" -> "mi-comunidad-nandu". Accents are stripped. */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

export function slugError(slug: string): string | null {
  if (slug.length === 0) return "Escribe un enlace para la comunidad.";
  if (slug.length < SLUG_MIN) return `El enlace debe tener al menos ${SLUG_MIN} caracteres.`;
  if (slug.length > SLUG_MAX) return `El enlace debe tener ${SLUG_MAX} caracteres como máximo.`;
  if (!SLUG_RE.test(slug)) return "Solo minúsculas, números y guiones (sin guion al inicio o al final).";
  return null;
}

export function communityNameError(name: string): string | null {
  const n = name.trim();
  if (n.length < 2) return "El nombre debe tener al menos 2 caracteres.";
  if (n.length > 50) return "El nombre debe tener 50 caracteres como máximo.";
  return null;
}

/** Trimmed message, or null if it can't be sent. */
export function cleanMessage(raw: string): string | null {
  const t = raw.trim();
  if (t.length === 0 || t.length > MESSAGE_MAX) return null;
  return t;
}
