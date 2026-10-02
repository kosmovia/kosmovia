"use client";

import { useEffect } from "react";
import { usePollar } from "@pollar/react";
import { PollarGate } from "../lib/pollar.tsx";
import { usePollarAuth } from "../hooks/usePollarAuth.ts";
import { useServerSession } from "../hooks/useServerSession.ts";
import { fetchServerSession } from "../lib/session-client.ts";
import { tokenStore } from "../lib/token-store.ts";

/**
 * Mounted once in the layout. Keeps the Supabase token in lib/token-store
 * alive: requests it after login, refreshes it before it expires, and clears
 * it on logout. Renders nothing.
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

  useEffect(() => {
    if (!address) {
      tokenStore.setRefresher(null);
      tokenStore.clear();
      return;
    }
    tokenStore.setRefresher(async () => {
      const result = await fetchServerSession(getClient(), address);
      return result.kind === "ok" ? result.session : null;
    });
    return () => tokenStore.setRefresher(null);
  }, [address, getClient]);

  return null;
}
