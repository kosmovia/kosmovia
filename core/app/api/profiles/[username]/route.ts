import { cleanUsernameParam } from "../../../../lib/api-input.ts";
import { failure, gate, handled, json, type Params } from "../../../../lib/api-route.ts";
import * as repo from "../../../../lib/db/repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/profiles/[username] (api backend)
 *
 * A public profile, like the `profiles_select_public` policy of the Supabase
 * schema: no session needed. -> { profile: ProfileRow }, or 404.
 */
export async function GET(request: Request, ctx: Params<{ username: string }>): Promise<Response> {
  const g = gate(request, "optional");
  if (!g.ok) return g.response;
  const username = cleanUsernameParam((await ctx.params).username);
  if (!username) return failure(404, "Perfil no encontrado.", "not_found");

  return handled("GET /api/profiles/:username", async () => {
    const profile = await repo.getProfileByUsername(username);
    if (!profile) return failure(404, "Perfil no encontrado.", "not_found");
    return json({ profile });
  });
}
