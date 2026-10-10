import { limitedResponse } from "../../../../../lib/core/api-limits.ts";
import { failure, handled, json, requireGate, type Params } from "../../../../../lib/core/api-route.ts";
import * as academia from "../../../../../lib/core/db/academia-repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/academia/lessons/[id] (api backend)
 * The text and the 4 questions WITHOUT the correct option or the explanations (they come back after answering).
 * -> { lesson: { id, title, summary, paragraphs, questions: Array<{ text, options }> }, progress: { best_score, completed } } | 404 not_found
 */
export async function GET(request: Request, ctx: Params<{ id: string }>): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("academiaRead", auth.session.profileId);
  if (limited) return limited;
  const { id } = await ctx.params;

  return handled("GET /api/academia/lessons/:id", async () => {
    const result = await academia.getLessonDetail(id, auth.session.profileId);
    if (!result.ok) return failure(result.denied.status, result.denied.error, result.denied.code);
    return json(result.value);
  });
}
