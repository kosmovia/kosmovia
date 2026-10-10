import { limitedResponse } from "../../../lib/core/api-limits.ts";
import { failure, handled, json, requireGate } from "../../../lib/core/api-route.ts";
import { checkUploadHeaders, nameFromHeader, parseUploadTarget, readBinaryBody } from "../../../lib/core/attachments-http.ts";
import { processUpload } from "../../../lib/core/attachments-process.ts";
import { getAttachmentStore } from "../../../lib/core/attachments-store.ts";
import * as attachments from "../../../lib/core/db/attachments-repo.ts";
import { isUuid } from "../../../lib/core/ids.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cuántos ids se pueden consultar de una vez (los 4 de un mensaje por varios mensajes de una página). */
const MAX_IDS = 48;

/**
 * POST /api/attachments?scope=channel&id=<channelId>   (o scope=dm&id=<threadId>)
 *
 * Cuerpo binario crudo (no multipart), `Content-Type: application/octet-stream`, `Content-Length` <= 5 MB y,
 * opcional, `X-Attachment-Name: <nombre con encodeURIComponent>`. Quien sube tiene que poder ESCRIBIR ahí
 * (miembro; #anuncios solo owner/admin; canal privado solo staff; no el canal de comprobantes) o ser parte del DM.
 * El tipo se decide por los bytes (PNG, JPEG, WEBP, GIF o PDF), nunca por la extensión. Las imágenes se
 * recodifican (sin EXIF, <= 2048 px) y llevan miniatura.
 * -> 201 { id, kind, name, size, width, height } | 400 | 404 | 411 | 413 | 415 | 429
 */
export async function POST(request: Request): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const profileId = auth.session.profileId;

  const target = parseUploadTarget(new URL(request.url).searchParams);
  if (!target.ok) return target.response;
  const limited = limitedResponse("attachmentWrite", profileId);
  if (limited) return limited;
  const headers = checkUploadHeaders(request);
  if (!headers.ok) return headers.response;

  return handled("POST /api/attachments", async () => {
    // Primero el permiso: a quien no puede escribir ahí ni se le lee el cuerpo.
    const access = await attachments.authorizeWrite(target.value, profileId);
    if (!access.ok) {
      if ("notFound" in access) {
        return failure(404, target.value.scope === "dm" ? "Conversación no encontrada." : "Canal no encontrado.", "not_found");
      }
      return failure(access.denied.status, access.denied.error, access.denied.code);
    }

    const body = await readBinaryBody(request, headers.length);
    if (!body.ok) return body.response;
    const processed = await processUpload(body.bytes, nameFromHeader(request));
    if (!processed.ok) return failure(processed.status, processed.error, processed.code);

    const file = processed.value;
    const saved = await getAttachmentStore().save(target.value.scope, {
      uploaderId: profileId,
      targetId: target.value.id,
      kind: file.kind,
      mime: file.mime,
      name: file.name,
      size: file.size,
      width: file.width,
      height: file.height,
      data: file.data,
      thumb: file.thumb,
    });
    if (!saved) return failure(403, "No puedes subir archivos aquí.", "forbidden");
    return json(saved, 201);
  });
}

/**
 * GET /api/attachments?ids=<id>,<id>,...   (hasta 48)
 *
 * Los datos (sin bytes) de los archivos que la persona puede leer, en el orden pedido; los demás se omiten.
 * El chat lo usa para dibujar las miniaturas y las tarjetas de PDF de los marcadores [ARCHIVO:<id>].
 * -> { attachments: Array<{ id, kind, name, size, width, height }> }
 */
export async function GET(request: Request): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = Array.from(new Set(raw.split(",").map((id) => id.trim().toLowerCase()).filter(Boolean)));
  if (ids.length === 0 || ids.length > MAX_IDS || !ids.every(isUuid)) return failure(400, "Los ids de archivo no son válidos.", "invalid_input");
  const limited = limitedResponse("attachmentRead", auth.session.profileId);
  if (limited) return limited;

  return handled("GET /api/attachments", async () => json({ attachments: await attachments.describeFor(ids, auth.session.profileId) }));
}
