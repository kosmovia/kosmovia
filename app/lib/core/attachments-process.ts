import sharp from "sharp";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_IMAGE_SIDE,
  THUMB_SIDE,
  sanitizeFileName,
  sniffFile,
  withExtension,
  type AttachmentKind,
} from "./attachments-rules.ts";

/**
 * Procesa un archivo subido antes de guardarlo. Server-only (sharp).
 *
 * - Imágenes: se decodifican y se vuelven a codificar como WEBP con sharp. Eso borra los metadatos
 *   (EXIF: GPS, cámara, fecha…), aplica la orientación, limita el lado mayor a 2048 px y
 *   neutraliza archivos "políglotas" (una imagen que además es otra cosa): lo que se guarda son
 *   píxeles recodificados, nunca los bytes que mandó el cliente. Se genera una miniatura de ~400 px.
 *   GIF: se guarda solo el primer cuadro, como imagen estática (no se conserva la animación).
 * - PDF: se guarda tal cual, verificado con `%PDF-` al inicio. Se sirve siempre como descarga
 *   con CSP sandbox y nosniff (ver fileResponseHeaders).
 */

/** Tope de píxeles que se aceptan al decodificar (frena las "bombas" de descompresión). */
const MAX_INPUT_PIXELS = 32_000_000;
const MAIN_QUALITY = 82;
const THUMB_QUALITY = 72;

export type ProcessedUpload = {
  kind: AttachmentKind;
  mime: string;
  name: string;
  size: number;
  width: number | null;
  height: number | null;
  data: Buffer;
  thumb: Buffer | null;
};

export type ProcessFailure = {
  ok: false;
  status: 400 | 413 | 415;
  code: "unsupported_type" | "invalid_image" | "image_too_large" | "file_too_large";
  error: string;
};

export async function processUpload(
  bytes: Buffer,
  rawName: string | null | undefined,
): Promise<{ ok: true; value: ProcessedUpload } | ProcessFailure> {
  if (bytes.length === 0) {
    return { ok: false, status: 400, code: "invalid_image", error: "El archivo está vacío." };
  }
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    return { ok: false, status: 413, code: "file_too_large", error: "El archivo pesa más de 5 MB." };
  }
  const sniffed = sniffFile(bytes);
  if (!sniffed) {
    return { ok: false, status: 415, code: "unsupported_type", error: "Solo imágenes (PNG, JPEG, WEBP o GIF) o PDF." };
  }

  if (sniffed.kind === "pdf") {
    const name = withExtension(sanitizeFileName(rawName, "documento"), "pdf");
    return {
      ok: true,
      value: { kind: "pdf", mime: "application/pdf", name, size: bytes.length, width: null, height: null, data: bytes, thumb: null },
    };
  }

  try {
    // animated:false = solo el primer cuadro de un GIF o WEBP animado. failOn:"error" = un archivo dañado se rechaza.
    const input = () => sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", animated: false });
    const main = await input()
      .rotate() // aplica la orientación del EXIF; sin withMetadata() el resultado sale sin metadatos
      .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: MAIN_QUALITY })
      .toBuffer({ resolveWithObject: true });
    const thumb = await sharp(main.data)
      .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();

    if (main.data.length > MAX_ATTACHMENT_BYTES) {
      return { ok: false, status: 413, code: "file_too_large", error: "El archivo pesa más de 5 MB." };
    }
    const name = withExtension(sanitizeFileName(rawName, "imagen"), "webp");
    return {
      ok: true,
      value: {
        kind: "image",
        mime: "image/webp",
        name,
        size: main.data.length,
        width: main.info.width,
        height: main.info.height,
        data: main.data,
        thumb,
      },
    };
  } catch (err) {
    const tooBig = /pixel limit|exceeds pixel/i.test(err instanceof Error ? err.message : "");
    return tooBig
      ? { ok: false, status: 413, code: "image_too_large", error: "La imagen tiene demasiados píxeles (máximo ~32 megapíxeles)." }
      : { ok: false, status: 400, code: "invalid_image", error: "No se pudo leer la imagen. Prueba con otra." };
  }
}
