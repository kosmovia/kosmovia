/**
 * Which data backend the app uses.
 *
 *  - "supabase" (default): the browser talks to Supabase with our ES256 token
 *    and RLS decides (supabase/migrations).
 *  - "api": the browser talks to our own /api routes with an httpOnly session
 *    cookie, and the server talks to a plain Postgres (db/migrations, lib/db).
 *    Meant for testing on a Render database.
 *
 * Two variables, because the browser can only read NEXT_PUBLIC_*:
 *   NEXT_PUBLIC_KOSMOVIA_DATA_BACKEND  hooks and session bridge (inlined by Next at build/dev start)
 *   KOSMOVIA_DATA_BACKEND              API routes (read at request time)
 * Set both to the same value. Unset or anything else = "supabase".
 */

export type DataBackend = "api" | "supabase";

export function parseBackend(value: string | undefined | null): DataBackend {
  return value?.trim().toLowerCase() === "api" ? "api" : "supabase";
}

/**
 * Browser/shared side. The literal `process.env.NEXT_PUBLIC_...` is what Next
 * replaces at build time, so it must stay written exactly like this.
 */
export function clientBackend(): DataBackend {
  return parseBackend(process.env.NEXT_PUBLIC_KOSMOVIA_DATA_BACKEND);
}

export function isApiBackend(): boolean {
  return clientBackend() === "api";
}

/** Server side: API routes. Reads at call time so tests and builds without env vars don't crash. */
export function serverBackend(env: Record<string, string | undefined> = process.env): DataBackend {
  return parseBackend(env.KOSMOVIA_DATA_BACKEND);
}
