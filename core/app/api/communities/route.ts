import { parseCommunityCreate } from "../../../lib/api-input.ts";
import { limitedResponse } from "../../../lib/api-limits.ts";
import { failure, gate, handled, json, readJsonBody, requireGate } from "../../../lib/api-route.ts";
import * as repo from "../../../lib/db/repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/communities (api backend)
 *
 * Explore: the newest 100 communities, public (no session needed). With a
 * session it also says which ones the caller belongs to.
 * -> { communities: CommunityRow[], mine: string[] }
 */
export async function GET(request: Request): Promise<Response> {
  const g = gate(request, "optional");
  if (!g.ok) return g.response;
  return handled("GET /api/communities", async () => {
    const communities = await repo.listCommunities(100);
    const mine = g.session ? await repo.listMyCommunityIds(g.session.profileId) : [];
    return json({ communities, mine });
  });
}

/**
 * POST /api/communities { name, slug, description?, icon? }
 *
 * The caller becomes the owner; a trigger adds them as a member and creates
 * #general and #anuncios. 201 { community }. 409 slug_taken | no_profile,
 * 429 quota_exceeded (3 per 24 h, 10 total).
 */
export async function POST(request: Request): Promise<Response> {
  const auth = requireGate(request);
  if (!auth.ok) return auth.response;
  const limited = limitedResponse("communityCreate", auth.session.profileId);
  if (limited) return limited;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const input = parseCommunityCreate(body.value);
  if (!input.ok) return failure(400, input.error, "invalid_input");

  return handled("POST /api/communities", async () => {
    const community = await repo.createCommunity({ ...input.value, ownerId: auth.session.profileId });
    return json({ community }, 201);
  });
}
