import { limitedResponse } from "../../../../../../lib/core/api-limits.ts";
import { failure, handled, json, readJsonBody, requireGate, type Params } from "../../../../../../lib/core/api-route.ts";
import * as academia from "../../../../../../lib/core/db/academia-repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/academia/lessons/[id]/answers { answers: number[] } (api backend)
 * One option index (0..3) per question. The SERVER grades it. 3 of 4 or more completes the lesson: 50 XP, only the first time.
 * -> { score, total, passed, xp_earned, corrections: Array<{ question, chosen, correct, is_correct, explanation }>,
 *      progress, summary, new_badges: string[] } | 400 invalid_input | 404 not_found
 */
export async function POST(request: Request, ctx: Params<{ id: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("academiaAnswer", auth.session.profileId);
  if (limited) return limited;
  const { id } = await ctx.params;

  const body = await readJsonBody(request, 1_024);
  if (!body.ok) return body.response;

  return handled("POST /api/academia/lessons/:id/answers", async () => {
    const result = await academia.submitAnswers(id, auth.session.profileId, body.value);
    if (!result.ok) return failure(result.denied.status, result.denied.error, result.denied.code);
    return json(result.value);
  });
}
