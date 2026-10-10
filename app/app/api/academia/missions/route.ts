import { limitedResponse } from "../../../../lib/core/api-limits.ts";
import { handled, json, requireGate } from "../../../../lib/core/api-route.ts";
import * as academia from "../../../../lib/core/db/academia-repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/academia/missions (api backend)
 * Status of the practical missions. It VERIFIES the pending ones with real data (PIN set, a payment sent with PIN,
 * a vaquita contribution) and grants the ones already met: 100 XP each, once.
 * -> { missions: Array<{ id, title, description, xp, completed, completed_at }>, summary, newly_completed: string[] }
 */
export async function GET(request: Request): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("academiaRead", auth.session.profileId);
  if (limited) return limited;

  return handled("GET /api/academia/missions", async () =>
    json(await academia.checkMissions(auth.session.profileId, auth.session.wallet)),
  );
}
