import { handled, json, requireGate } from "../../../../lib/api-route.ts";
import { limitedResponse } from "../../../../lib/api-limits.ts";
import * as repo from "../../../../lib/db/repo.ts";
import { sugerirUsernames } from "../../../../lib/usernames.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COUNT = 6;

/**
 * GET /api/usernames/sugerencias (api backend)
 *
 * 6 @usuarios temáticos que todavía nadie tiene. -> { usernames: string[] }
 * Pide sesión (la de la wallet, aunque aún no haya perfil) y tiene límite de uso.
 */
export async function GET(request: Request): Promise<Response> {
  const gate = requireGate(request);
  if (!gate.ok) return gate.response;
  const limited = limitedResponse("usernameSuggest", gate.session.profileId);
  if (limited) return limited;

  return handled("GET /api/usernames/sugerencias", async () => {
    const candidatos = sugerirUsernames(COUNT * 3);
    const ocupados = await repo.takenUsernames(candidatos);
    const usernames = candidatos.filter((u) => !ocupados.has(u)).slice(0, COUNT);
    return json({ usernames });
  });
}
