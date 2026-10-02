"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { usePollar } from "@pollar/react";
import { PollarGate } from "../lib/pollar.tsx";
import { usePollarAuth } from "../hooks/usePollarAuth.ts";
import { useServerSession } from "../hooks/useServerSession.ts";
import { isApiBackend } from "../lib/backend.ts";
import { fetchServerSession } from "../lib/session-client.ts";
import { REFRESH_MARGIN_MS, tokenStore } from "../lib/token-store.ts";

/**
 * Mounted once in the layout. Keeps the server session alive: requests it
 * after login, refreshes it before it expires, and clears it on logout.
 * Renders nothing.
 *
 * - supabase backend: the session is the Supabase token in lib/token-store,
 *   refreshed lazily when a request finds <5 min left.
 * - api backend: the session is an httpOnly cookie. The bridge calls
 *   POST /api/auth/session once after login (useServerSession), re-calls it
 *   shortly before the cookie expires, and calls POST /api/auth/logout when the
 *   user logs out. A 401 on any request also re-signs once (lib/api-client.ts).
 */
export function SessionBridge() {
  return (
    <PollarGate fallback={null}>
      <Inner />
    </PollarGate>
  );
}

function Inner() {
  const { user, verified } = usePollarAuth();
  const { getClient } = usePollar();
  const address = user?.address ?? null;
  useServerSession(address, verified);
  const api = isApiBackend();
  const hadAddress = useRef(false);

  useEffect(() => {
    if (!address) {
      tokenStore.setRefresher(null);
      tokenStore.clear();
      // Logged out (not just "not logged in yet"): drop the httpOnly cookie too.
      if (api && hadAddress.current) {
        void fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
      }
      hadAddress.current = false;
      return;
    }
    hadAddress.current = true;
    tokenStore.setRefresher(async () => {
      const result = await fetchServerSession(getClient(), address);
      return result.kind === "ok" ? result.session : null;
    });
    return () => tokenStore.setRefresher(null);
  }, [address, getClient, api]);

  // api backend: re-sign a little before the cookie expires.
  const session = useSyncExternalStore(
    tokenStore.subscribe,
    () => tokenStore.getSnapshot().session,
    () => null,
  );
  const expiresAt = session?.expiresAt ?? null;
  useEffect(() => {
    if (!api || expiresAt === null) return;
    const wait = Math.max(5_000, expiresAt - Date.now() - REFRESH_MARGIN_MS);
    const timer = setTimeout(() => void tokenStore.refreshNow(), wait);
    return () => clearTimeout(timer);
  }, [api, expiresAt]);

  return null;
}
