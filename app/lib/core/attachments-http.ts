import { MAX_ATTACHMENT_BYTES, isAttachmentScope, type AttachmentScope } from "./attachments-rules.ts";
import { failure } from "./api-route.ts";
import { isUuid } from "./ids.ts";

/**
 * Entrada HTTP de los archivos adjuntos: el destino (`?scope=&id=`), el nombre (cabecera) y el cuerpo binario
 * crudo, con su tope. Plain `Response`s, como api-route.ts. Server-only.
 */

export type UploadTarget = { scope: AttachmentScope; id: string };

/** `?scope=channel|dm&id=<uuid>`. */
export function parseUploadTarget(params: URLSearchParams): { ok: true; value: UploadTarget } | { ok: false; response: Response } {
  const scope = params.get("scope");
  const id = params.get("id");
  if (!isAttachmentScope(scope)) return { ok: false, response: failure(400, "Falta el destino del archivo (scope).", "invalid_input") };
  if (!id || !isUuid(id)) {
    return { ok: false, response: failure(404, scope === "dm" ? "Conversación no encontrada." : "Canal no encontrado.", "not_found") };
  }
  return { ok: true, value: { scope, id: id.toLowerCase() } };
}

/** Nombre original del archivo: cabecera `X-Attachment-Name` con encodeURIComponent. Se limpia después con sanitizeFileName. */
export function nameFromHeader(request: Request): string | null {
  const raw = request.headers.get("x-attachment-name");
  if (!raw || raw.length > 600) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * Valida lo que se sabe sin leer el cuerpo: content-type octet-stream (un formulario o un fetch cruzado no puede
 * mandarlo sin permiso previo del navegador) y content-length presente y dentro del tope.
 */
export function checkUploadHeaders(request: Request): { ok: true; length: number } | { ok: false; response: Response } {
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/octet-stream") {
    return { ok: false, response: failure(415, "Se esperaba el archivo en bruto (application/octet-stream).", "bad_content_type") };
  }
  const raw = request.headers.get("content-length");
  if (raw === null || !/^\d{1,12}$/.test(raw)) {
    return { ok: false, response: failure(411, "Falta el tamaño del archivo (content-length).", "length_required") };
  }
  const length = Number(raw);
  if (length === 0) return { ok: false, response: failure(400, "El archivo está vacío.", "invalid_input") };
  if (length > MAX_ATTACHMENT_BYTES) return { ok: false, response: failure(413, "El archivo pesa más de 5 MB.", "file_too_large") };
  return { ok: true, length };
}

/**
 * Lee el cuerpo por partes y corta en cuanto pasa el tope, sin fiarse solo del content-length declarado.
 * El largo real tiene que coincidir con el declarado.
 */
export async function readBinaryBody(
  request: Request,
  declared: number,
  max = MAX_ATTACHMENT_BYTES,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; response: Response }> {
  const tooBig = { ok: false as const, response: failure(413, "El archivo pesa más de 5 MB.", "file_too_large") };
  if (!request.body) return { ok: false, response: failure(400, "El archivo está vacío.", "invalid_input") };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        return tooBig;
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, response: failure(400, "No se pudo leer el archivo.", "bad_body") };
  }
  if (total !== declared) {
    return { ok: false, response: failure(400, "El tamaño del archivo no coincide con lo declarado.", "bad_body") };
  }
  return { ok: true, bytes: Buffer.concat(chunks, total) };
}
