"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePollar } from "@pollar/react";
import { signedFetch } from "../lib/auth-client.ts";

export type ServerSession =
  | { step: "idle" }
  | { step: "checking" }
  | { step: "ok"; address: string }
  | { step: "error"; message: string };

/**
 * Proves to our own server who the user is (SEP-53 signature, see lib/auth.ts)
 * by calling POST /api/auth/session once per login. With Freighter this opens
 * one signature popup. Only call it under <PollarGate>.
 */
export function useServerSession(address: string | null, verified: boolean) {
  const { getClient } = usePollar();
  const [session, setSession] = useState<ServerSession>({ step: "idle" });
  const checkedFor = useRef<string | null>(null);

  const check = useCallback(async () => {
    if (!address) return;
    setSession({ step: "checking" });
    try {
      const res = await signedFetch(getClient(), address, "/api/auth/session", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { address?: string; error?: string };
      if (!res.ok || !body.address) {
        setSession({ step: "error", message: body.error ?? "El servidor no pudo verificar tu sesión." });
        return;
      }
      setSession({ step: "ok", address: body.address });
    } catch (err) {
      setSession({ step: "error", message: err instanceof Error ? err.message : "No se pudo firmar la sesión." });
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
