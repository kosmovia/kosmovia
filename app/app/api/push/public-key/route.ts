import { json } from "../../../../lib/core/api-route.ts";
import { readVapid } from "../../../../lib/core/push.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/push/public-key (público)
 *
 * La clave pública VAPID que el navegador necesita para suscribirse. Sin las tres
 * variables VAPID_* el push está apagado: -> { configured: false, publicKey: null }.
 */
export async function GET(): Promise<Response> {
  const vapid = readVapid();
  return json({ configured: vapid !== null, publicKey: vapid?.publicKey ?? null });
}
