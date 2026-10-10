import { limitedResponse } from "../../../../lib/core/api-limits.ts";
import { failure, handled, json, requireGate, type Params } from "../../../../lib/core/api-route.ts";
import { fileResponseHeaders } from "../../../../lib/core/attachments-rules.ts";
import * as attachments from "../../../../lib/core/db/attachments-repo.ts";
import { isUuid } from "../../../../lib/core/ids.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/attachments/[id]
 *
 * El archivo, solo para quien puede LEER su canal o conversación (si ya va en un mensaje) o para quien lo subió
 * (si todavía no). Para cualquier otra persona, 404. Cabeceras: Content-Type del guardado, nosniff,
 * Content-Disposition (imagen en línea; PDF como descarga con nombre limpio), CSP `default-src 'none'; sandbox`
 * y Cache-Control privado de una hora.
 */
export async function GET(request: Request, ctx: Params<{ id: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const id = (await ctx.params).id.toLowerCase();
  if (!isUuid(id)) return failure(404, "Archivo no encontrado.", "not_found");
  const limited = limitedResponse("attachmentRead", auth.session.profileId);
  if (limited) return limited;

  return handled("GET /api/attachments/:id", async () => {
    const found = await attachments.readFileFor(id, auth.session.profileId, "file");
    if (!found.ok) return failure(404, "Archivo no encontrado.", "not_found");
    const { file } = found;
    return new Response(new Uint8Array(file.bytes), { status: 200, headers: fileResponseHeaders(file, "file", file.bytes.length) });
  });
}

/**
 * DELETE /api/attachments/[id]
 *
 * Quita un archivo que todavía no va en ningún mensaje (la "x" de la bandeja). Solo quien lo subió.
 * Los que ya van en un mensaje se borran con el mensaje.
 * -> 200 { ok: true } | 404
 */
export async function DELETE(request: Request, ctx: Params<{ id: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const id = (await ctx.params).id.toLowerCase();
  if (!isUuid(id)) return failure(404, "Archivo no encontrado.", "not_found");
  const limited = limitedResponse("attachmentWrite", auth.session.profileId);
  if (limited) return limited;

  return handled("DELETE /api/attachments/:id", async () => {
    const removed = await attachments.discard(id, auth.session.profileId);
    return removed ? json({ ok: true }) : failure(404, "Archivo no encontrado.", "not_found");
  });
}
