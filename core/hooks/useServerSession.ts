"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePollar } from "@pollar/react";
import { fetchServerSession, reusableSession } from "../lib/session-client.ts";
import { tokenStore } from "../lib/token-store.ts";

export type ServerSession =
  | { step: "idle" }
  | { step: "checking" }
  /** `supabase: false` = wallet verified, but the server can't mint Supabase tokens yet. */
  | { step: "ok"; address: string; profileId?: string; supabase: boolean }
  | { step: "error"; message: string };

/**
 * Proves to our own server who the user is (SEP-53 signature, see lib/auth.ts)
 * by calling POST /api/auth/session once per login. With Freighter this opens
 * one signature popup. On success the Supabase token goes to lib/token-store
 * (the data hooks read it from there). With the api backend there is no token:
 * the server sets an httpOnly cookie, and on a reload the cookie is tried first
 * so the wallet is not asked to sign again. Only call it under <PollarGate>.
 */
export function useServerSession(address: string | null, verified: boolean) {
  const { getClient } = usePollar();
  const [session, setSession] = useState<ServerSession>({ step: "idle" });
  const checkedFor = useRef<string | null>(null);

  const check = useCallback(async () => {
    if (!address) return;
    const reuse = reusableSession(address);
    if (reuse) {
      setSession({ step: "ok", address: reuse.address, profileId: reuse.profileId, supabase: true });
      return;
    }
    setSession({ step: "checking" });
    tokenStore.setStatus("checking");
    const result = await fetchServerSession(getClient(), address, { allowCookie: true });
    if (result.kind === "ok") {
      tokenStore.set(result.session);
      setSession({
        step: "ok",
        address: result.session.address,
        profileId: result.session.profileId,
        supabase: true,
      });
    } else if (result.kind === "unconfigured") {
      tokenStore.setStatus("unconfigured", result.message);
      setSession({ step: "ok", address: result.address, supabase: false });
    } else {
      tokenStore.setStatus("error", result.message);
      setSession({ step: "error", message: result.message });
    }
  }, [address, getClient]);

  useEffect(() => {
    if (!address || !verified) {
      checkedFor.current = null;
      setSession({ step: "idle" });
      return;
    }
    if (checkedFor.current === address) return;
    checkedFor.current = address;
    void check();
  }, [address, verified, check]);

  return { session, retry: check };
}
