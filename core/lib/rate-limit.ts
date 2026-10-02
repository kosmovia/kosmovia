/**
 * Light in-memory guards for the API routes: a sliding-window rate limiter, a
 * small LRU set, and in-flight dedupe. Server-only, no dependencies.
 *
 * BEST-EFFORT: state lives in one process. On serverless (Vercel) every warm
 * instance has its own copy and cold starts reset it, so these limits slow
 * abuse down but do not guarantee a cap. A persistent limiter (Supabase table
 * or Vercel KV) is the follow-up: see docs/POLLAR-NOTES.md.
 */

export type LimitDecision = { ok: true } | { ok: false; retryAfterSeconds: number };

export interface RateLimiter {
  /** Would `key` be allowed right now? Records nothing. */
  peek(key: string, now?: number): LimitDecision;
  /** Records a hit when allowed, and says whether it was. */
  take(key: string, now?: number): LimitDecision;
  /** Distinct keys currently remembered (for tests). */
  size(): number;
  clear(): void;
}

export interface RateLimiterOptions {
  /** Hits allowed per window, per key. */
  max: number;
  windowMs: number;
  /** Keys remembered at most; the least recently used goes first. */
  maxKeys?: number;
}

/** Sliding window log per key (at most `max` timestamps each), LRU across keys. */
export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const { max, windowMs } = opts;
  const maxKeys = opts.maxKeys ?? 5_000;
  const hits = new Map<string, number[]>();

  function recent(key: string, now: number): number[] {
    const list = hits.get(key);
    if (!list) return [];
    const cutoff = now - windowMs;
    let i = 0;
    while (i < list.length && list[i] <= cutoff) i += 1;
    return i === 0 ? list : list.slice(i);
  }

  function decide(list: number[], now: number): LimitDecision {
    if (list.length < max) return { ok: true };
    const retryAfterMs = list[0] + windowMs - now;
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  return {
    peek(key, now = Date.now()) {
      return decide(recent(key, now), now);
    },
    take(key, now = Date.now()) {
      const list = recent(key, now);
      const decision = decide(list, now);
      if (!decision.ok) return decision;
      list.push(now);
      // Re-insert so the Map's order is least recently used first.
      hits.delete(key);
      hits.set(key, list);
      while (hits.size > maxKeys) {
        const oldest = hits.keys().next();
        if (oldest.done) break;
        hits.delete(oldest.value);
      }
      return decision;
    },
    size: () => hits.size,
    clear: () => hits.clear(),
  };
}

/** A bounded set with least-recently-used eviction. */
export interface LruSet {
  has(key: string): boolean;
  add(key: string): void;
  size(): number;
  clear(): void;
}

export function createLruSet(maxEntries = 5_000): LruSet {
  const set = new Set<string>();
  return {
    has(key) {
      if (!set.has(key)) return false;
      set.delete(key);
      set.add(key);
      return true;
    },
    add(key) {
      set.delete(key);
      set.add(key);
      while (set.size > maxEntries) {
        const oldest = set.values().next();
        if (oldest.done) break;
        set.delete(oldest.value);
      }
    },
    size: () => set.size,
    clear: () => set.clear(),
  };
}

/** Runs `fn` once per key at a time: callers arriving meanwhile share its promise. */
export interface InFlight {
  run<T>(key: string, fn: () => Promise<T>): Promise<T>;
  size(): number;
}

export function createInFlight(): InFlight {
  const pending = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const existing = pending.get(key);
      if (existing) return existing as Promise<T>;
      const promise = fn().finally(() => {
        pending.delete(key);
      });
      pending.set(key, promise);
      return promise;
    },
    size: () => pending.size,
  };
}

/**
 * Best guess of the caller's IP. On Vercel `x-forwarded-for` / `x-real-ip` are
 * set by the platform (client-sent values are overwritten); elsewhere they are
 * spoofable, which only makes the per-IP limit weaker, never the per-wallet one.
 */
export function clientIp(request: Request): string {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first ? first.slice(0, 64) : "unknown";
}

/** A 429 in Spanish with `Retry-After`. */
export function tooManyRequests(retryAfterSeconds: number, message: string): Response {
  return Response.json(
    { error: message, code: "rate_limited", retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds), "Cache-Control": "no-store" } },
  );
}

/**
 * Checks every `[limiter, key]` pair and records a hit on all of them only if
 * all allow it (so one denied limiter does not burn the other's budget).
 * Returns the first denial, or null when the request may go on.
 */
export function takeAll(pairs: Array<[RateLimiter, string]>, now?: number): { retryAfterSeconds: number } | null {
  for (const [limiter, key] of pairs) {
    const decision = limiter.peek(key, now);
    if (!decision.ok) return { retryAfterSeconds: decision.retryAfterSeconds };
  }
  for (const [limiter, key] of pairs) limiter.take(key, now);
  return null;
}
