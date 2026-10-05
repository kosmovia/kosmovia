import { cleanUsernameParam, cleanWalletParam } from "../../../../lib/core/api-input.ts";
import { failure, gate, handled, json, type Params } from "../../../../lib/core/api-route.ts";
import * as repo from "../../../../lib/core/db/repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/profiles/[username] (api backend)
 *
 * A public profile, like the `profiles_select_public` policy of the Supabase
 * schema: no session needed. -> { profile: ProfileRow }, or 404.
 * The param can also be a G-address: the profile that owns that wallet (so a
 * pasted address shows who it is before sending money).
 */
export async function GET(request: Request, ctx: Params<{ username: string }>): Promise<Response> {
  const g = gate(request, "optional");
  if (!g.ok) return g.response;
  const raw = (await ctx.params).username;
  const wallet = cleanWalletParam(raw);
  const username = wallet ? null : cleanUsernameParam(raw);
  if (!wallet && !username) return failure(404, "Perfil no encontrado.", "not_found");

  return handled("GET /api/profiles/:username", async () => {
    const profile = wallet ? await repo.getProfileByWallet(wallet) : await repo.getProfileByUsername(username as string);
    if (!profile) return failure(404, "Perfil no encontrado.", "not_found");
    return json({ profile });
  });
}
