"use client";

import type { PollarClient } from "@pollar/core";
import { signedFetch } from "./auth-client.ts";
import { isApiBackend } from "./backend.ts";
import { REFRESH_MARGIN_MS, tokenStore, type StoredSession } from "./token-store.ts";

export type SessionResult =
  | { kind: "ok"; session: StoredSession }
  /** The server verified the wallet but has no signing key / secret configured. */
  | { kind: "unconfigured"; address: string; message: string }
  | { kind: "error"; message: string };

type Body = {
  address?: string;
  profileId?: string;
  token?: string;
  expiresAt?: number;
  backend?: string;
  error?: string;
  code?: string;
};

let inflight: { address: string; promise: Promise<SessionResult> } | null = null;

export interface FetchSessionOptions {
  /**
   * api backend only: try the httpOnly cookie first (GET /api/auth/session), so
   * a page reload does not ask the wallet to sign again. Off for refreshes: the
   * cookie we already have is the one about to expire.
   */
  allowCookie?: boolean;
}

/**
 * POST /api/auth/session once per address at a time (the login panel, the
 * bridge and the token refresh may all ask at once: they share one request,
 * so Freighter shows a single signature popup).
 */
export function fetchServerSession(
  client: PollarClient,
  address: string,
  options: FetchSessionOptions = {},
): Promise<SessionResult> {
  if (inflight && inflight.address === address) return inflight.promise;
  const promise = run(client, address, options).finally(() => {
    if (inflight?.promise === promise) inflight = null;
  });
  inflight = { address, promise };
  return promise;
}

/** The cookie session for `address` if the server still honors it with room to spare. */
async function sessionFromCookie(address: string): Promise<StoredSession | null> {
  try {
    const res = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as Body;
    if (body.address !== address || !body.profileId || !body.expiresAt) return null;
    if (body.expiresAt - Date.now() <= REFRESH_MARGIN_MS) return null;
    return { address: body.address, profileId: body.profileId, token: "", expiresAt: body.expiresAt };
  } catch {
    return null;
  }
}

async function run(client: PollarClient, address: string, options: FetchSessionOptions): Promise<SessionResult> {
  try {
    if (options.allowCookie && isApiBackend()) {
      const existing = await sessionFromCookie(address);
      if (existing) return { kind: "ok", session: existing };
    }

    const res = await signedFetch(client, address, "/api/auth/session", { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as Body;
    // api backend: no token in the body, the session is the httpOnly cookie.
    const hasCredential = Boolean(body.token) || body.backend === "api";
    if (res.ok && body.address && body.profileId && body.expiresAt && hasCredential) {
      return {
        kind: "ok",
        session: {
          address: body.address,
          profileId: body.profileId,
          token: body.token ?? "",
          expiresAt: body.expiresAt,
        },
      };
    }
    if (
      res.status === 503 &&
      (body.code === "supabase_not_configured" || body.code === "session_not_configured") &&
      body.address
    ) {
      return {
        kind: "unconfigured",
        address: body.address,
        message: body.error ?? "Falta configurar la sesión en el servidor.",
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
