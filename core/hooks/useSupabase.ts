"use client";

import { useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, SUPABASE_MISSING_MESSAGE } from "../lib/supabase.ts";
import { tokenStore, type SessionStatus, type StoredSession } from "../lib/token-store.ts";

export interface SupabaseState {
  /** False when NEXT_PUBLIC_SUPABASE_URL / ANON_KEY are missing. */
  configured: boolean;
  client: SupabaseClient | null;
  /** Present once the wallet is verified and the server issued a token. */
  session: StoredSession | null;
  status: SessionStatus;
  message: string | null;
  /** Spanish explanation when data can't be used yet, otherwise null. */
  blocker: string | null;
}

/** Connection state shared by every data hook. */
export function useSupabase(): SupabaseState {
  const snap = useSyncExternalStore(tokenStore.subscribe, tokenStore.getSnapshot, tokenStore.getSnapshot);
  const client = getSupabase();

  let blocker: string | null = null;
  if (!client) blocker = SUPABASE_MISSING_MESSAGE;
  else if (!snap.session) {
    if (snap.status === "checking") blocker = "Verificando tu sesión…";
    else if (snap.status === "unconfigured") blocker = "Falta configurar Supabase en el servidor.";
    else if (snap.status === "error") blocker = snap.message ?? "No se pudo verificar tu sesión.";
    else blocker = "Entra con tu wallet para continuar.";
  }

  return {
    configured: client !== null,
    client,
    session: snap.session,
    status: snap.status,
    message: snap.message,
    blocker,
  };
}
