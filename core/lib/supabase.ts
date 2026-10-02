import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { tokenStore } from "./token-store.ts";

export const SUPABASE_MISSING_MESSAGE = "Falta configurar Supabase";

/** Read at call time so tests and builds without env vars don't crash. */
export function readSupabaseEnv(
  url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
): { ok: true; url: string; anonKey: string } | { ok: false; message: string } {
  const u = url?.trim();
  const k = anonKey?.trim();
  if (!u || !k) return { ok: false, message: SUPABASE_MISSING_MESSAGE };
  return { ok: true, url: u, anonKey: k };
}

let client: SupabaseClient | null | undefined;

/**
 * Browser client (singleton). Authenticates with OUR token through the
 * `accessToken` option, not Supabase Auth. Returns null when the public env
 * vars are missing.
 */
export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const env = readSupabaseEnv();
  if (!env.ok) {
    client = null;
    return client;
  }
  client = createClient(env.url, env.anonKey, {
    accessToken: () => tokenStore.getToken(),
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return client;
}
