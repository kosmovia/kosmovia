/**
 * Reglas puras de los archivos adjuntos (sin red, sin base de datos, sin node:*):
 * las usan el servidor y el navegador.
 *
 * - Tipos permitidos: PNG, JPEG, WEBP, GIF y PDF, reconocidos por sus bytes mágicos
 *   (nunca por la extensión ni por el content-type que diga el cliente).
 * - Un mensaje con archivos lleva un marcador `[ARCHIVO:<id>]` por archivo (máx. 4)
 *   más el texto opcional. El servidor comprueba cada id antes de publicar.
 */

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 4;
/** Lado máximo de una imagen guardada, en px. */
export const MAX_IMAGE_SIDE = 2048;
/** Lado mayor de la miniatura, en px. */
export const THUMB_SIDE = 400;
export const NAME_MAX = 120;
/** Un marcador `[ARCHIVO:<uuid>]` mide 45 caracteres, más el salto de línea que lo separa del siguiente. */
export const MARKER_LENGTH = 46;

export const ACCEPT_ATTR = "image/png,image/jpeg,image/webp,image/gif,application/pdf";

export type AttachmentScope = "channel" | "dm";
export type AttachmentKind = "image" | "pdf";
export type ImageFormat = "png" | "jpeg" | "webp" | "gif";
export type Sniffed = { kind: "image"; format: ImageFormat } | { kind: "pdf" };

export const isAttachmentScope = (value: unknown): value is AttachmentScope => value === "channel" || value === "dm";

// ------------------------------------------------------------- bytes mágicos

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));

/**
 * Qué es el archivo según sus primeros bytes, o null si no es de los permitidos
 * (por ejemplo, un HTML con extensión .png).
 */
export function sniffFile(bytes: Uint8Array): Sniffed | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "image", format: "png" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: "image", format: "jpeg" };
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return { kind: "image", format: "gif" };
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return { kind: "image", format: "webp" };
  if (startsWith(bytes, ascii("%PDF-"))) return { kind: "pdf" };
  return null;
}

// ------------------------------------------------------------------- nombres

/** Caracteres que no van en un nombre de archivo, y los de control/dirección de texto (un RLO disfraza una extensión). */
// eslint-disable-next-line no-control-regex
const BAD_NAME_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿<>:"|?*\\/]/g;

/**
 * Nombre limpio y de hasta NAME_MAX caracteres: sin rutas, sin caracteres de control ni de
 * dirección de texto, sin puntos ni espacios en las puntas. Conserva la extensión al recortar.
 */
export function sanitizeFileName(raw: string | null | undefined, fallback: string): string {
  let name = String(raw ?? "");
  try {
    name = name.normalize("NFC");
  } catch {
    /* cadena rara: se sigue con lo que hay */
  }
  name = name.split(/[\\/]/).pop() ?? "";
  name = name.replace(BAD_NAME_CHARS, "_").replace(/\s+/g, " ").trim().replace(/^[.\s_]+|[.\s]+$/g, "");
  if (!name) return fallback;
  return clampName(name);
}

function clampName(name: string): string {
  const chars = Array.from(name);
  if (chars.length <= NAME_MAX) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : "";
  const keep = NAME_MAX - Array.from(ext).length;
  return Array.from(name.slice(0, dot > 0 && ext ? dot : name.length)).slice(0, keep).join("") + ext;
}

/** El mismo nombre con la extensión del formato real (un .png que en realidad es WEBP queda .webp). */
export function withExtension(name: string, ext: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return clampName(`${base.trim() || "archivo"}.${ext}`);
}

/** Nombre solo ASCII (para `filename=` de Content-Disposition). */
export function asciiFileName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/_{2,}/g, "_").trim();
  return safe.replace(/^[._]+/, "") || "archivo";
}

/** Tamaño legible: 1,2 MB, 340 KB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

// ---------------------------------------------------------------- marcadores

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const markerRe = () => new RegExp(`\\[ARCHIVO:(${UUID})\\]`, "gi");

/** Mensajes con formato propio (cobro, vaquita): jamás llevan adjuntos, aunque su texto parezca un marcador. */
export function hasSpecialTag(content: string): boolean {
  return /^\s*\[(COBRO_B2B|VAQUITA):/.test(content);
}

/** Los ids marcados en el contenido, en orden, en minúsculas y con repetidos. */
export function attachmentIdsOf(content: string): string[] {
  if (hasSpecialTag(content)) return [];
  return Array.from(content.matchAll(markerRe()), (m) => m[1].toLowerCase());
}

export type MarkerCheck = { ok: true; ids: string[] } | { ok: false; code: "too_many_attachments" | "duplicate_attachment"; error: string };

/** Los ids de un mensaje nuevo: máximo 4 y sin repetir. */
export function checkMarkers(content: string): MarkerCheck {
  const ids = attachmentIdsOf(content);
  if (ids.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return { ok: false, code: "too_many_attachments", error: `Máximo ${MAX_ATTACHMENTS_PER_MESSAGE} archivos por mensaje.` };
  }
  if (new Set(ids).size !== ids.length) {
    return { ok: false, code: "duplicate_attachment", error: "Un archivo no puede ir dos veces en el mismo mensaje." };
  }
  return { ok: true, ids };
}

/** Contenido separado en ids y texto (sin marcadores). */
export function splitContent(content: string): { ids: string[]; text: string } {
  const ids = attachmentIdsOf(content);
  if (ids.length === 0) return { ids, text: content };
  return { ids, text: content.replace(markerRe(), "").replace(/\n{3,}/g, "\n\n").trim() };
}

/** Los marcadores (uno por línea) y después el texto, si lo hay. */
export function joinContent(ids: string[], text: string): string {
  const body = text.trim();
  const markers = ids.map((id) => `[ARCHIVO:${id}]`).join("\n");
  return body ? (markers ? `${markers}\n${body}` : body) : markers;
}

/** Texto corto para listas y avisos push: nunca el marcador crudo. */
export function previewText(content: string): string {
  const { ids, text } = splitContent(content);
  if (ids.length === 0) return content;
  if (text) return `📎 ${text}`;
  return ids.length > 1 ? "📎 Archivos" : "📎 Archivo";
}

/** Editar no puede quitar, agregar ni reordenar marcadores. */
export function sameMarkers(before: string, after: string): boolean {
  const a = attachmentIdsOf(before);
  const b = attachmentIdsOf(after);
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

// ------------------------------------------------------- vínculo con mensajes

export type AttachmentLinkRow = {
  id: string;
  uploader_id: string;
  scope: string;
  channel_id: string | null;
  dm_thread_id: string | null;
  message_id: string | null;
};

export type LinkCheck =
  | { ok: true }
  | { ok: false; reason: "missing" | "not_yours" | "wrong_place" | "already_used"; error: string };

const LINK_ERRORS = {
  missing: "Uno de los archivos ya no está disponible. Quítalo y súbelo de nuevo.",
  not_yours: "Uno de los archivos ya no está disponible. Quítalo y súbelo de nuevo.",
  wrong_place: "Un archivo se subió para otra conversación. Quítalo y súbelo aquí.",
  already_used: "Un archivo ya se envió en otro mensaje. Súbelo de nuevo.",
} as const;

/**
 * Cada id marcado tiene que existir, ser de quien publica, ser de este mismo canal o conversación
 * y no estar usado. "No existe" y "es de otra persona" dan el mismo aviso: no se revela que un id ajeno existe.
 */
export function checkLinkable(
  rows: AttachmentLinkRow[],
  ids: string[],
  ctx: { profileId: string; scope: AttachmentScope; targetId: string },
): LinkCheck {
  const byId = new Map(rows.map((r) => [r.id.toLowerCase(), r]));
  for (const id of ids) {
    const row = byId.get(id.toLowerCase());
    const fail = (reason: keyof typeof LINK_ERRORS): LinkCheck => ({ ok: false, reason, error: LINK_ERRORS[reason] });
    if (!row) return fail("missing");
    if (row.uploader_id !== ctx.profileId) return fail("not_yours");
    const target = ctx.scope === "channel" ? row.channel_id : row.dm_thread_id;
    if (row.scope !== ctx.scope || target !== ctx.targetId) return fail("wrong_place");
    if (row.message_id !== null) return fail("already_used");
  }
  return { ok: true };
}

/**
 * Leer un archivo: si ya va en un mensaje, quien puede leer ese canal o conversación;
 * si todavía no (bandeja de envío), solo quien lo subió.
 */
export function canReadAttachment(
  row: { uploader_id: string; message_id: string | null },
  viewerId: string,
  containerReadable: boolean,
): boolean {
  if (row.message_id === null) return row.uploader_id === viewerId;
  return containerReadable;
}

// --------------------------------------------------------- cabeceras de salida

export type FileVariant = "file" | "thumb";

/**
 * Cabeceras de los archivos servidos. El navegador no debe interpretar nunca un adjunto como página:
 * nosniff + CSP sin nada + sandbox. Las imágenes van en línea; el PDF, como descarga con nombre limpio.
 */
export function fileResponseHeaders(
  file: { kind: AttachmentKind; mime: string; name: string },
  variant: FileVariant,
  length: number,
): Record<string, string> {
  const inline = variant === "thumb" || file.kind === "image";
  const name = file.name;
  const disposition = inline
    ? "inline"
    : `attachment; filename="${asciiFileName(name)}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
  return {
    "Content-Type": variant === "thumb" ? "image/webp" : file.mime,
    "Content-Length": String(length),
    "Content-Disposition": disposition,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "private, max-age=3600",
  };
}
