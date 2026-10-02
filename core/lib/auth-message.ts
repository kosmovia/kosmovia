/** Shared between client (signs) and server (verifies): no server-only or browser-only imports here. */

export const PROOF_HEADER = "x-kosmovia-proof";

/** Prefix of every signed message. Bump the version when the shape changes, so an old tab's proof fails instead of being read under new rules. */
export const AUTH_PREFIX = "kosmovia-auth:v1";

/** Collections whose next path segment is an id, not a route. */
const ID_PARENTS = new Set(["communities", "channels", "profiles"]);
/** ...except these, which are real routes sitting where an id would go. */
const NOT_IDS = new Set(["mine"]);

/**
 * `/api/communities/3f2a/join` -> `/api/communities/:id/join`.
 *
 * The signature is bound to the shape of the route, not to one concrete id:
 * with an external wallet (Freighter) each signature is a popup, so this keeps
 * one signature per endpoint while a proof captured from a harmless GET still
 * can't be replayed against another endpoint or method.
 */
export function normalizeRoute(path: string): string {
  const segments = path.split("/");
  return segments
    .map((segment, index) => {
      const parent = segments[index - 1];
      if (!parent || !ID_PARENTS.has(parent)) return segment;
      if (!segment || NOT_IDS.has(segment)) return segment;
      return ":id";
    })
    .join("/");
}

/** What actually gets signed: which endpoint, who, and until when. */
export function authMessage(address: string, exp: number, method: string, path: string): string {
  return `${AUTH_PREFIX}:${method.toUpperCase()} ${normalizeRoute(path)}:${address}:${exp}`;
}
