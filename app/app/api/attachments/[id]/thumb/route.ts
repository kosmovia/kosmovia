import { limitedResponse } from "../../../../../lib/core/api-limits.ts";
import { failure, handled, requireGate, type Params } from "../../../../../lib/core/api-route.ts";
import { fileResponseHeaders } from "../../../../../lib/core/attachments-rules.ts";
import * as attachments from "../../../../../lib/core/db/attachments-repo.ts";
import { isUuid } from "../../../../../lib/core/ids.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/attachments/[id]/thumb
 *
 * La miniatura (~400 px, WEBP) de una imagen, con el mismo permiso y las mismas cabeceras que el archivo.
 * Un PDF no tiene miniatura: 404.
 */
export async function GET(request: Request, ctx: Params<{ id: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const id = (await ctx.params).id.toLowerCase();
  if (!isUuid(id)) return failure(404, "Archivo no encontrado.", "not_found");
  const limited = limitedResponse("attachmentRead", auth.session.profileId);
  if (limited) return limited;

  return handled("GET /api/attachments/:id/thumb", async () => {
    const found = await attachments.readFileFor(id, auth.session.profileId, "thumb");
    if (!found.ok) return failure(404, "Archivo no encontrado.", "not_found");
    const { file } = found;
    return new Response(new Uint8Array(file.bytes), { status: 200, headers: fileResponseHeaders(file, "thumb", file.bytes.length) });
  });
}
