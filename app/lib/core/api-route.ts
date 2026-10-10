import { serverBackend } from "./backend.ts";
import { classifyDbError, dbErrorCode } from "./db/errors.ts";
import { dbConfigured } from "./db/pool.ts";
import { DbNotConfiguredError } from "./db/repo.ts";
import { readCookie, readSessionSecret, requireSession, SESSION_COOKIE, verifySessionCookie } from "./session-cookie.ts";

/**
 * Shared plumbing of the REST routes of the "api" backend: the gate every route
 * passes first (backend on, database configured, valid session cookie), JSON
 * bodies with a size cap, and the translation of failures into answers.
 * Plain `Response`s, so tests can call the handlers without booting Next.
 * Server-only.
 */

const NO_STORE = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function failure(status: number, error: string, code: string): Response {
  return json({ error, code }, status);
}

/** `issuedAt`: cuándo se emitió la cookie (`iat`, epoch ms). El PIN lo usa para "olvidé mi PIN" (sesión de hace < 10 min). */
export type Session = { profileId: string; wallet: string; issuedAt: number };
export type Gate = { ok: true; session: Session | null } | { ok: false; response: Response };

/**
 * `auth: "required"` answers 401 without a session; `"optional"` lets public
 * reads through and returns the session when there is one.
 * Order: backend off -> 404, no DATABASE_URL -> 503 db_not_configured, session.
 */
export function gate(request: Request, auth: "required" | "optional"): Gate {
  if (serverBackend() !== "api") {
    return { ok: false, response: failure(404, "No encontrado.", "backend_disabled") };
  }
  if (!dbConfigured()) {
    return {
      ok: false,
      response: failure(503, "Falta configurar la base de datos (DATABASE_URL) en el servidor.", "db_not_configured"),
    };
  }
  if (auth === "required") {
    const outcome = requireSession(request);
    if (!outcome.ok) return { ok: false, response: outcome.response };
    return { ok: true, session: { profileId: outcome.profileId, wallet: outcome.wallet, issuedAt: outcome.issuedAt } };
  }
  // Optional: a missing or bad cookie is just "anonymous".
  const secret = readSessionSecret();
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!secret || !token) return { ok: true, session: null };
  const verified = verifySessionCookie(token, secret);
  return {
    ok: true,
    session: verified.ok
      ? { profileId: verified.claims.sub, wallet: verified.claims.wallet, issuedAt: verified.claims.iat * 1000 }
      : null,
  };
}

/** Same as {@link gate} but narrowed: the session is there or the response is the answer. */
export function requireGate(request: Request): { ok: true; session: Session } | { ok: false; response: Response } {
  const g = gate(request, "required");
  if (!g.ok) return g;
  return { ok: true, session: g.session as Session };
}

/** A JSON object body, capped in size. Anything else is a 400. */
export async function readJsonBody(
  request: Request,
  maxBytes = 8_192,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const bad = (error: string, code: string, status = 400) => ({ ok: false as const, response: failure(status, error, code) });
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    return bad("Se esperaba application/json.", "bad_content_type", 415);
  }
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return bad("No se pudo leer la solicitud.", "bad_body");
  }
  if (raw.length > maxBytes) return bad("La solicitud es demasiado grande.", "body_too_large", 413);
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return bad("JSON inválido.", "bad_json");
  }
}

/**
 * Runs a route body and turns any thrown database error into its answer. Logs
 * the route and the error code, never the message, the SQL or any value.
 */
export async function handled(route: string, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DbNotConfiguredError) {
      return failure(503, "Falta configurar la base de datos (DATABASE_URL) en el servidor.", "db_not_configured");
    }
    const failureInfo = classifyDbError(err);
    if (failureInfo.status >= 500) console.error(`api.error route=${route} code=${dbErrorCode(err)}`);
    return failure(failureInfo.status, failureInfo.error, failureInfo.code);
  }
}

/** Route `params` of Next 16 arrive as a promise. */
export type Params<T extends Record<string, string>> = { params: Promise<T> };
