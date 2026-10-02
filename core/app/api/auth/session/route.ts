import { requireSignedAddress } from "../../../../lib/auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/session
 *
 * Verifies the SEP-53 proof in the `x-kosmovia-proof` header and answers with
 * the address that signed it. The address comes from the signature, never from
 * the body.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = requireSignedAddress(request);
  if (!auth.ok) return auth.response;

  // TODO(etapa A, paso 4: Supabase): aquí se emite el JWT de Supabase firmado
  // con SUPABASE_JWT_PRIVATE_KEY (ES256), según la sección 2 de
  // docs/ARQUITECTURA.md: sub = id del usuario (upsert en `profiles` por wallet),
  // role = "authenticated", wallet = auth.address, vencimiento de 1 hora.
  // Por ahora solo se confirma la identidad; no se devuelve ningún token.
  return Response.json({ address: auth.address }, { headers: { "Cache-Control": "no-store" } });
}
