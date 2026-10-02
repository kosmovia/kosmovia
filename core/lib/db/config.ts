import type { PoolConfig } from "pg";

/**
 * Connection settings for the "api" backend (plain Postgres), built from
 * DATABASE_URL. Pure: no network, and no error ever echoes the URL (it holds
 * the password). Server-only; shared by lib/db/pool.ts and scripts/db-migrate.mjs.
 */

export const DB_MISSING_MESSAGE = "Falta configurar DATABASE_URL en el servidor.";

export type SslMode = "verify" | "no-verify" | "off";

export interface ConfigOptions {
  /**
   * TLS policy. `verify` (default): full certificate verification. `no-verify`:
   * encrypted but the certificate chain is not checked. `off`: plain TCP
   * (only ever the default for localhost). Overridable with DATABASE_SSL.
   */
  ssl?: SslMode;
  max?: number;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname.toLowerCase());
}

export function parseSslMode(raw: string | undefined | null): SslMode | undefined {
  const v = raw?.trim().toLowerCase();
  if (v === "verify" || v === "no-verify" || v === "off") return v;
  return undefined;
}

/**
 * Splits the URL ourselves instead of passing `connectionString` to pg: pg lets
 * `?sslmode=` in the URL override the `ssl` option, which would silently
 * change the TLS policy decided here.
 */
export function buildPoolConfig(databaseUrl: string, options: ConfigOptions = {}): PoolConfig {
  let url: URL;
  try {
    url = new URL(databaseUrl.trim());
  } catch {
    // Never include the input: it is a credential.
    throw new Error("DATABASE_URL no es una URL válida (postgresql://usuario:clave@host/base).");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL debe empezar con postgresql://");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!url.hostname || !database) {
    throw new Error("DATABASE_URL debe incluir host y nombre de base.");
  }

  const mode: SslMode = options.ssl ?? (isLocalHost(url.hostname) ? "off" : "verify");
  const ssl = mode === "off" ? false : { rejectUnauthorized: mode === "verify" };

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    ssl,
    max: options.max ?? 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // A runaway query must not hold a pooled connection for long.
    statement_timeout: 10_000,
  };
}

/** Reads DATABASE_URL (+ optional DATABASE_SSL). `null` when DATABASE_URL is missing. */
export function readDbConfig(env: Record<string, string | undefined> = process.env): PoolConfig | null {
  const url = env.DATABASE_URL?.trim();
  if (!url) return null;
  return buildPoolConfig(url, { ssl: parseSslMode(env.DATABASE_SSL) });
}

/** A short, secret-free description of a connection failure. Never prints err.message of network errors (it can hold the host). */
export function describeConnectionError(err: unknown): string {
  const e = err as { code?: unknown; severity?: unknown; message?: unknown } | null;
  const code = typeof e?.code === "string" ? e.code : "unknown";
  // A Postgres server error (it has a severity) carries SQL text, not connection data.
  if (typeof e?.severity === "string" && typeof e?.message === "string") return `${code}: ${e.message}`;
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/.test(code)) {
    return `${code} (el certificado TLS del servidor no se pudo verificar)`;
  }
  return code;
}
