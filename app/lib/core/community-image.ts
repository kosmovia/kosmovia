/**
 * Foto de comunidad: una data URL chica que el navegador ya recortó y achicó.
 * El servidor no confía en el tipo declarado: lo revisa por los primeros bytes
 * (webp, png o jpeg; nunca SVG, que puede llevar scripts) y limita el tamaño.
 * Pura y sin dependencias de Node, para usarla también en el cliente.
 */

export const COMMUNITY_IMAGE_MAX_BYTES = 64 * 1024;
const DATA_URL_RE = /^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;

export type ImageCheck = { ok: true; value: string } | { ok: false; error: string };

function decodeBase64(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** El tipo real por sus bytes ("magic numbers"). */
export function sniffImage(bytes: Uint8Array): "webp" | "png" | "jpeg" | null {
  const b = bytes;
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return "webp";
  }
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return "png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  return null;
}

export function checkCommunityImage(raw: unknown): ImageCheck {
  if (typeof raw !== "string") return { ok: false, error: "La foto no es válida." };
  const match = DATA_URL_RE.exec(raw.trim());
  if (!match) return { ok: false, error: "La foto tiene que ser WebP, PNG o JPEG." };
  const bytes = decodeBase64(match[2]);
  if (!bytes) return { ok: false, error: "La foto no es válida." };
  if (bytes.length > COMMUNITY_IMAGE_MAX_BYTES) return { ok: false, error: "La foto pesa demasiado (máximo 64 KB)." };
  const real = sniffImage(bytes);
  if (!real) return { ok: false, error: "Ese archivo no es una imagen WebP, PNG o JPEG." };
  if (real !== match[1]) return { ok: false, error: "El tipo de la foto no coincide con su contenido." };
  return { ok: true, value: raw.trim() };
}
