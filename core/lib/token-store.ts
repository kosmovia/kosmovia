/**
 * In-memory holder of the session (browser). With the Supabase backend the
 * client asks it for the token on every request; when less than 5 minutes
 * remain it calls the registered refresher (which re-runs POST
 * /api/auth/session). With the api backend `token` is "" (the real session is
 * the httpOnly cookie) and this only tracks who is logged in and until when.
 * Nothing is persisted: a reload signs in again (api backend: it first tries the
 * cookie, see lib/session-client.ts).
 */

export interface StoredSession {
  address: string;
  profileId: string;
  token: string;
  /** Epoch ms. */
  expiresAt: number;
}

/** What the UI needs to know about the Supabase session. */
export type SessionStatus = "idle" | "checking" | "ready" | "unconfigured" | "error";

export interface StoreSnapshot {
  session: StoredSession | null;
  status: SessionStatus;
  message: string | null;
}

export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

type Refresher = () => Promise<StoredSession | null>;
type Listener = () => void;

export function createTokenStore(now: () => number = Date.now) {
  let current: StoredSession | null = null;
  let snapshot: StoreSnapshot = { session: null, status: "idle", message: null };
  let refresher: Refresher | null = null;
  let inflight: Promise<StoredSession | null> | null = null;
  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach((l) => l());

  async function refresh(): Promise<StoredSession | null> {
    if (!refresher) return current;
    inflight ??= refresher()
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
    const next = await inflight;
    if (next) {
      current = next;
      snapshot = { session: next, status: "ready", message: null };
      emit();
    }
    return current;
  }

  return {
    set(session: StoredSession | null) {
      current = session;
      snapshot = { session, status: session ? "ready" : "idle", message: null };
      emit();
    },
    clear() {
      current = null;
      snapshot = { session: null, status: "idle", message: null };
      emit();
    },
    setStatus(status: SessionStatus, message: string | null = null) {
      current = status === "ready" ? current : null;
      snapshot = { session: current, status, message };
      emit();
    },
    /** Stable between changes: safe for useSyncExternalStore. */
    getSnapshot(): StoreSnapshot {
      return snapshot;
    },
    get(): StoredSession | null {
      return current;
    },
    setRefresher(fn: Refresher | null) {
      refresher = fn;
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Re-runs the registered refresher now (api backend: a 401 means the cookie is gone or expired). */
    refreshNow(): Promise<StoredSession | null> {
      return refresh();
    },
    /** Valid token or null. Refreshes first when <5 min are left. */
    async getToken(): Promise<string | null> {
      if (!current) return null;
      if (current.expiresAt - now() < REFRESH_MARGIN_MS) await refresh();
      if (!current || current.expiresAt <= now()) return null;
      return current.token;
    },
  };
}

export const tokenStore = createTokenStore();
