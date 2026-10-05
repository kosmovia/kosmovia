import { failure, handled, json, readJsonBody, requireGate } from "../../../lib/core/api-route.ts";
import { limitedResponse } from "../../../lib/core/api-limits.ts";
import { parseProfileCreate, parseProfileUpdate } from "../../../lib/core/api-input.ts";
import * as repo from "../../../lib/core/db/repo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Own profile (api backend). Identity is the session cookie: the profile id and
 * wallet are the session's, never the body's. trust_level and the X columns can't
 * be written from here.
 *
 *   GET   -> { profile: ProfileRow | null }
 *   POST  -> create. 201 { profile }; 409 profile_exists | username_taken
 *   PATCH -> update username, displayName, avatarSeed, avatarStyle, bio. 200 { profile }
 */
export async function GET(request: Request): Promise<Response> {
  const gate = requireGate(request);
  if (!gate.ok) return gate.response;
  return handled("GET /api/profile", async () => {
    const profile = await repo.getProfileById(gate.session.profileId);
    return json({ profile });
  });
}

export async function POST(request: Request): Promise<Response> {
  const gate = requireGate(request);
  if (!gate.ok) return gate.response;
  const limited = limitedResponse("profileWrite", gate.session.profileId);
  if (limited) return limited;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const input = parseProfileCreate(body.value);
  if (!input.ok) return failure(400, input.error, "invalid_input");

  return handled("POST /api/profile", async () => {
    const profile = await repo.createProfile({
      id: gate.session.profileId,
      wallet: gate.session.wallet,
      ...input.value,
    });
    return json({ profile }, 201);
  });
}

export async function PATCH(request: Request): Promise<Response> {
  const gate = requireGate(request);
  if (!gate.ok) return gate.response;
  const limited = limitedResponse("profileWrite", gate.session.profileId);
  if (limited) return limited;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const input = parseProfileUpdate(body.value);
  if (!input.ok) return failure(400, input.error, "invalid_input");

  return handled("PATCH /api/profile", async () => {
    const profile = await repo.updateOwnProfile(gate.session.profileId, input.value);
    if (!profile) return failure(404, "Crea tu perfil primero.", "no_profile");
    return json({ profile });
  });
}
