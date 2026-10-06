import { requireGate } from "../../../../lib/core/api-route.ts";
import { readJwtConfig, signSessionJwt } from "../../../../lib/core/jwt.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/realtime/token
 *
 * Un token con el que el navegador puede abrir la conexión de Supabase
 * Realtime, y nada más. Hace falta porque la sesión vive en una cookie
 * httpOnly: el navegador no puede leerla, así que no tiene con qué
 * identificarse ante Supabase.
 *
 * Es el mismo JWT ES256 que firma el servidor para el modo Supabase
 * (lib/core/jwt.ts), con `sub` = id del perfil y `role: authenticated`, así que
 * las políticas RLS deciden qué mensajes recibe cada quien: un canal privado
 * no llega a quien no es miembro, y eso lo garantiza la base, no el cliente.
 *
 * Solo se emite para una sesión que ya pasó la cookie: nunca para una wallet
 * enviada en la petición. Sin SUPABASE_JWT_PRIVATE_KEY / SUPABASE_JWT_KEY_ID
 * responde 503 y el cliente se queda con el polling.
 */
export async function GET(request: Request): Promise<Response> {
  const gate = requireGate(request);
  if (!gate.ok) return gate.response;

  const config = readJwtConfig();
  if (!config.ok) {
    return Response.json(
      {
        error: "Falta configurar la clave de firma de Supabase en el servidor.",
        code: "realtime_not_configured",
      },
      { status: 503, headers: NO_STORE },
    );
  }

  try {
    const { token, expiresAt } = signSessionJwt({
      privateKeyPem: config.privateKeyPem,
      keyId: config.keyId,
      profileId: gate.session.profileId,
      wallet: gate.session.wallet,
    });
    return Response.json({ token, expiresAt }, { headers: NO_STORE });
  } catch {
    // Una clave mal formada. Nunca se devuelve el motivo ni la clave.
    console.error("api.error route=realtime/token code=jwt_sign_failed");
    return Response.json(
      { error: "No se pudo emitir el token de tiempo real.", code: "realtime_not_configured" },
      { status: 503, headers: NO_STORE },
    );
  }
}
