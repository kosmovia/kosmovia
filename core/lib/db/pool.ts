import pg from "pg";
import { readDbConfig } from "./config.ts";

/**
 * Lazy singleton pool for the "api" backend. Nothing connects at import or at
 * build time: the first query creates the pool, and the pool opens connections
 * only when used. Kept on globalThis so `next dev` hot reloads don't leak pools.
 * Server-only.
 */

const KEY = Symbol.for("kosmovia.pg.pool");
type Holder = { [KEY]?: pg.Pool | null };

/** The shared pool, or null when DATABASE_URL is not set (routes answer 503 db_not_configured). */
export function getPool(env: Record<string, string | undefined> = process.env): pg.Pool | null {
  const holder = globalThis as Holder;
  if (holder[KEY] !== undefined) return holder[KEY] ?? null;

  const config = readDbConfig(env);
  if (!config) return null; // not cached: the variable may be set later (tests)

  const pool = new pg.Pool(config);
  // An idle client dying must not crash the server. Log the code only.
  pool.on("error", (err: Error) => {
    console.error(`db.pool.error code=${(err as { code?: string }).code ?? "unknown"}`);
  });
  holder[KEY] = pool;
  return pool;
}

/** Closes the pool (scripts and tests). */
export async function closePool(): Promise<void> {
  const holder = globalThis as Holder;
  const pool = holder[KEY];
  holder[KEY] = undefined;
  if (pool) await pool.end();
}

export function dbConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.DATABASE_URL?.trim());
}
