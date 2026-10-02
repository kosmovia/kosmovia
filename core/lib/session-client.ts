"use client";

import type { PollarClient } from "@pollar/core";
import { signedFetch } from "./auth-client.ts";
import { REFRESH_MARGIN_MS, tokenStore, type StoredSession } from "./token-store.ts";

export type SessionResult =
  | { kind: "ok"; session: StoredSession }
  /** The server verified the wallet but has no Supabase signing key configured. */
  | { kind: "unconfigured"; address: string; message: string }
  | { kind: "error"; message: string };

type Body = {
  address?: string;
  profileId?: string;
  token?: string;
  expiresAt?: number;
  error?: string;
  code?: string;
};

let inflight: { address: string; promise: Promise<SessionResult> } | null = null;

/**
 * POST /api/auth/session once per address at a time (the login panel, the
 * bridge and the token refresh may all ask at once: they share one request,
 * so Freighter shows a single signature popup).
 */
export function fetchServerSession(client: PollarClient, address: string): Promise<SessionResult> {
  if (inflight && inflight.address === address) return inflight.promise;
  const promise = run(client, address).finally(() => {
    if (inflight?.promise === promise) inflight = null;
  });
  inflight = { address, promise };
  return promise;
}

async function run(client: PollarClient, address: string): Promise<SessionResult> {
  try {
    const res = await signedFetch(client, address, "/api/auth/session", { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as Body;
    if (res.ok && body.address && body.token && body.profileId && body.expiresAt) {
      return {
        kind: "ok",
        session: {
          address: body.address,
          profileId: body.profileId,
          token: body.token,
          expiresAt: body.expiresAt,
        },
      };
    }
    if (res.status === 503 && body.code === "supabase_not_configured" && body.address) {
      return {
        kind: "unconfigured",
        address: body.address,
        message: body.error ?? "Falta configurar Supabase en el servidor.",
      };
    }
    return { kind: "error", message: body.error ?? "El servidor no pudo verificar tu sesión." };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : "No se pudo firmar la sesión." };
  }
}

/** A stored session for `address` that still has more than the refresh margin left. */
export function reusableSession(address: string, now = Date.now()): StoredSession | null {
  const s = tokenStore.get();
  return s && s.address === address && s.expiresAt - now > REFRESH_MARGIN_MS ? s : null;
}
