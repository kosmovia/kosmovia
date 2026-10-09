"use client";

import { tokenStore } from "./token-store.ts";

/**
 * fetch() for our own REST routes (api backend). The session is the httpOnly
 * `kosmovia_session` cookie, so there is no token to attach: only
 * `credentials: "same-origin"`. If the server answers 401 while the app thinks
 * it is logged in (the cookie expired or was cleared), it re-runs the session
 * refresher once (POST /api/auth/session) and retries the request.
 */

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; code?: string; extra?: Record<string, unknown> };

export interface ApiInit {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

const NETWORK_ERROR = "No se pudo conectar con el servidor. Revisa tu conexión.";

async function send(path: string, init: ApiInit): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(path, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function parse<T>(res: Response): Promise<ApiResult<T>> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (res.ok) return { ok: true, status: res.status, data: body };
  return {
    ok: false,
    status: res.status,
    error: typeof body.error === "string" ? body.error : "Algo salió mal. Intenta de nuevo.",
    code: typeof body.code === "string" ? body.code : undefined,
    // Datos extra de algunos errores (attemptsLeft, lockedUntil, remaining…).
    extra: body && typeof body === "object" ? (body as Record<string, unknown>) : undefined,
  };
}

export async function apiRequest<T>(path: string, init: ApiInit = {}): Promise<ApiResult<T>> {
  try {
    // Near expiry this re-signs the session first (no-op otherwise).
    await tokenStore.getToken();
    let res = await send(path, init);
    if (res.status === 401 && tokenStore.get()) {
      const before = tokenStore.get();
      const after = await tokenStore.refreshNow();
      if (after && after !== before) res = await send(path, init);
    }
    return await parse<T>(res);
  } catch {
    return { ok: false, status: 0, error: NETWORK_ERROR };
  }
}
