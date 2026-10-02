"use client";

import { useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isApiBackend } from "../lib/backend.ts";
import { getSupabase, SUPABASE_MISSING_MESSAGE } from "../lib/supabase.ts";
import { tokenStore, type SessionStatus, type StoredSession } from "../lib/token-store.ts";

export interface SupabaseState {
  /**
   * supabase backend: false when NEXT_PUBLIC_SUPABASE_URL / ANON_KEY are
   * missing. api backend: always true (a missing DATABASE_URL shows up as the
   * server's 503 `db_not_configured`, in each hook's error).
   */
  configured: boolean;
  /** Always null with the api backend: the hooks call our /api routes instead. */
  client: SupabaseClient | null;
  /** Present once the wallet is verified and the server issued a session. */
  session: StoredSession | null;
  status: SessionStatus;
  message: string | null;
  /** Spanish explanation when data can't be used yet, otherwise null. */
  blocker: string | null;
}

/**
 * Connection state shared by every data hook, for both backends (the name is
 * historical): the session comes from lib/token-store either way; only the
 * Supabase client is specific to the supabase backend.
 */
export function useSupabase(): SupabaseState {
  const snap = useSyncExternalStore(tokenStore.subscribe, tokenStore.getSnapshot, tokenStore.getSnapshot);
  const api = isApiBackend();
  const client = api ? null : getSupabase();
  const configured = api || client !== null;

  let blocker: string | null = null;
  if (!configured) blocker = SUPABASE_MISSING_MESSAGE;
  else if (!snap.session) {
    if (snap.status === "checking") blocker = "Verificando tu sesión…";
    else if (snap.status === "unconfigured") {
      blocker = api ? "Falta configurar SESSION_SECRET en el servidor." : "Falta configurar Supabase en el servidor.";
    } else if (snap.status === "error") blocker = snap.message ?? "No se pudo verificar tu sesión.";
    else blocker = "Entra con tu wallet para continuar.";
  }

  return {
    configured,
    client,
    session: snap.session,
    status: snap.status,
    message: snap.message,
    blocker,
  };
}
