import { limitedResponse } from "../../../../lib/core/api-limits.ts";
import { handled, json, requireGate } from "../../../../lib/core/api-route.ts";
import * as academia from "../../../../lib/core/db/academia-repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/academia/lessons (api backend)
 * The 5 lessons with my progress, plus my XP and badges.
 * -> { lessons: Array<{ id, title, summary, question_count, best_score: number | null, completed }>,
 *      summary: { xp, lessons_completed, missions_completed, badges: Array<{ id, name, description, earned }> } }
 */
export async function GET(request: Request): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("academiaRead", auth.session.profileId);
  if (limited) return limited;

  return handled("GET /api/academia/lessons", async () => json(await academia.listLessons(auth.session.profileId)));
}
