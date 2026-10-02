/**
 * Abuse guards: the in-memory limiter, LRU and in-flight dedupe, the funding
 * route (limits, dedupe, funded memory) and the limits on /api/x/*. No real
 * network and no real keys: Pollar and X are replaced by injected or patched fetch.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Keypair } from "@stellar/stellar-base";

import { POST as fundRoute } from "../app/api/wallet/fund/route.ts";
import { POST as challengeRoute } from "../app/api/x/challenge/route.ts";
import { POST as verifyRoute } from "../app/api/x/verify/route.ts";
import { authMessage, PROOF_HEADER } from "../lib/auth-message.ts";
import {
  FUND_IP_LIMIT,
  FUND_WALLET_LIMIT,
  createFundGuards,
  fundWallet,
  resetFundState,
  type Fetcher,
} from "../lib/fund.ts";
import { clientIp, createInFlight, createLruSet, createRateLimiter, takeAll } from "../lib/rate-limit.ts";
import { resetXLimits, X_CHALLENGE_WALLET_LIMIT, X_VERIFY_WALLET_LIMIT } from "../lib/x-limits.ts";

const HOUR = 60 * 60 * 1000;

// ------------------------------------------------------------------ limiter

test("rate limiter allows `max` per window, then says when to retry", () => {
  const limiter = createRateLimiter({ max: 3, windowMs: HOUR });
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i += 1) assert.deepEqual(limiter.take("a", t0 + i * 1000), { ok: true });
  const denied = limiter.take("a", t0 + 5_000);
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.retryAfterSeconds, Math.ceil((t0 + HOUR - (t0 + 5_000)) / 1000));
  // Another key is independent.
  assert.deepEqual(limiter.take("b", t0), { ok: true });
  // The window slides: once the first hit (t0) expires there is room for exactly one more.
  assert.deepEqual(limiter.take("a", t0 + HOUR + 1), { ok: true });
  assert.equal(limiter.take("a", t0 + HOUR + 2).ok, false);
  // And after the second hit expires too, one more.
  assert.equal(limiter.take("a", t0 + 1_000 + HOUR + 1).ok, true);
});

test("peek never records, and takeAll does not burn a budget when another limiter denies", () => {
  const a = createRateLimiter({ max: 1, windowMs: HOUR });
  const b = createRateLimiter({ max: 5, windowMs: HOUR });
  assert.deepEqual(a.peek("x", 0), { ok: true });
  assert.deepEqual(a.peek("x", 0), { ok: true });
  assert.equal(takeAll([[a, "x"], [b, "x"]], 0), null);
  // `a` is now exhausted: the second call is denied and `b` is not charged.
  assert.ok(takeAll([[a, "x"], [b, "x"]], 1));
  for (let i = 0; i < 4; i += 1) assert.deepEqual(b.take("x", 2), { ok: true });
  assert.equal(b.take("x", 3).ok, false);
});

test("rate limiter is an LRU: it never remembers more than maxKeys", () => {
  const limiter = createRateLimiter({ max: 1, windowMs: HOUR, maxKeys: 3 });
  for (const key of ["a", "b", "c"]) limiter.take(key, 0);
  limiter.take("a", 1); // denied, does not refresh
  limiter.take("d", 2); // evicts the least recently used: "a"
  assert.equal(limiter.size(), 3);
  assert.equal(limiter.peek("a", 3).ok, true, "a was forgotten");
  assert.equal(limiter.peek("d", 3).ok, false);
  for (let i = 0; i < 100; i += 1) limiter.take(`k${i}`, 4);
  assert.equal(limiter.size(), 3);
});

test("LRU set evicts the least recently used", () => {
  const set = createLruSet(2);
  set.add("a");
  set.add("b");
  assert.equal(set.has("a"), true); // refreshes a
  set.add("c"); // evicts b
  assert.equal(set.has("b"), false);
  assert.equal(set.has("a"), true);
  assert.equal(set.has("c"), true);
  assert.equal(set.size(), 2);
});

test("in-flight dedupe shares one promise per key and forgets it after", async () => {
  const flight = createInFlight();
  let runs = 0;
  let release!: (value: number) => void;
  const gate = new Promise<number>((resolve) => {
    release = resolve;
  });
  const job = () => {
    runs += 1;
    return gate;
  };
  const results = [flight.run("w", job), flight.run("w", job), flight.run("w", job)];
  assert.equal(flight.size(), 1);
  release(7);
  assert.deepEqual(await Promise.all(results), [7, 7, 7]);
  assert.equal(runs, 1);
  assert.equal(flight.size(), 0);
  await flight.run("w", async () => 1);
  assert.equal(runs, 1);
});

test("clientIp prefers x-real-ip, then the first x-forwarded-for hop", () => {
  const req = (headers: Record<string, string>) => new Request("https://kosmovia.test/", { headers });
  assert.equal(clientIp(req({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1" })), "203.0.113.9");
  assert.equal(clientIp(req({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" })), "198.51.100.4");
  assert.equal(clientIp(req({})), "unknown");
});

// -------------------------------------------------------------- fund (lib)

function pollarFetcher(status: number, calls: string[] = []): { fetcher: Fetcher; calls: string[] } {
  return {
    calls,
    fetcher: async (_url, init) => {
      calls.push(String(JSON.parse(String(init.body)).publicKey));
      return new Response("{}", { status });
    },
  };
}

const wallet = () => Keypair.random().publicKey();

test("fund: a funded wallet (200 or 409) is remembered and never hits Pollar again", async () => {
  resetFundState();
  const guards = createFundGuards();
  for (const status of [200, 409]) {
    const address = wallet();
    const { fetcher, calls } = pollarFetcher(status);
    const first = await fundWallet({ address, ip: "1.1.1.1", secret: "sec_testnet_x", fetcher, guards });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { address, funded: true, alreadyFunded: status === 409 });
    for (let i = 0; i < 20; i += 1) {
      const again = await fundWallet({ address, ip: "1.1.1.1", secret: "sec_testnet_x", fetcher, guards });
      assert.equal(again.status, 200);
      assert.equal(again.body.alreadyFunded, true);
    }
    assert.equal(calls.length, 1, `status ${status}`);
  }
});

test("fund: concurrent calls for one wallet share a single Pollar request", async () => {
  resetFundState();
  const guards = createFundGuards();
  const address = wallet();
  let calls = 0;
  const fetcher: Fetcher = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return new Response("{}", { status: 200 });
  };
  const outcomes = await Promise.all(
    Array.from({ length: 8 }, () => fundWallet({ address, ip: "2.2.2.2", secret: "sec_testnet_x", fetcher, guards })),
  );
  assert.equal(calls, 1);
  assert.ok(outcomes.every((o) => o.status === 200));
});

test("fund: 3 failed attempts per wallet per hour, then 429 without calling Pollar", async () => {
  resetFundState();
  const guards = createFundGuards();
  const address = wallet();
  const { fetcher, calls } = pollarFetcher(502);
  for (let i = 0; i < FUND_WALLET_LIMIT; i += 1) {
    const outcome = await fundWallet({ address, ip: "3.3.3.3", secret: "sec_testnet_x", fetcher, guards, now: 1_000 + i });
    assert.equal(outcome.status, 502, "failures are not remembered as funded");
  }
  const denied = await fundWallet({ address, ip: "3.3.3.3", secret: "sec_testnet_x", fetcher, guards, now: 2_000 });
  assert.equal(denied.status, 429);
  assert.equal(denied.body.code, "rate_limited");
  assert.ok((denied.retryAfterSeconds ?? 0) > 0);
  assert.equal(calls.length, FUND_WALLET_LIMIT);
  // An hour later the wallet may try again.
  const later = await fundWallet({ address, ip: "3.3.3.3", secret: "sec_testnet_x", fetcher, guards, now: 1_000 + HOUR + 10 });
  assert.equal(later.status, 502);
  assert.equal(calls.length, FUND_WALLET_LIMIT + 1);
});

test("fund: 10 attempts per IP per hour across different wallets", async () => {
  resetFundState();
  const guards = createFundGuards();
  const { fetcher, calls } = pollarFetcher(502);
  for (let i = 0; i < FUND_IP_LIMIT; i += 1) {
    const outcome = await fundWallet({ address: wallet(), ip: "4.4.4.4", secret: "sec_testnet_x", fetcher, guards, now: 5_000 });
    assert.equal(outcome.status, 502);
  }
  const denied = await fundWallet({ address: wallet(), ip: "4.4.4.4", secret: "sec_testnet_x", fetcher, guards, now: 5_000 });
  assert.equal(denied.status, 429);
  assert.equal(calls.length, FUND_IP_LIMIT);
  // Another IP is unaffected.
  const other = await fundWallet({ address: wallet(), ip: "5.5.5.5", secret: "sec_testnet_x", fetcher, guards, now: 5_000 });
  assert.equal(other.status, 502);
});

test("fund: Pollar's statuses map to the documented answers", async () => {
  resetFundState();
  const guards = createFundGuards();
  const expected: Array<[number, number, string]> = [
    [402, 503, "funding_wallet_empty"],
    [404, 404, "not_app_wallet"],
    [500, 502, "pollar_error"],
  ];
  for (const [pollar, status, code] of expected) {
    const outcome = await fundWallet({
      address: wallet(),
      ip: "6.6.6.6",
      secret: "sec_testnet_x",
      fetcher: pollarFetcher(pollar).fetcher,
      guards,
    });
    assert.equal(outcome.status, status);
    assert.equal(outcome.body.code, code);
  }
  const unreachable = await fundWallet({
    address: wallet(),
    ip: "6.6.6.7",
    secret: "sec_testnet_x",
    fetcher: async () => {
      throw new Error("down");
    },
    guards,
  });
  assert.equal(unreachable.status, 502);
  assert.equal(unreachable.body.code, "pollar_unreachable");
});

// ------------------------------------------------------------ fund (route)

const ORIGIN = "https://kosmovia.test";

function signedRequest(keypair: Keypair, path: string, options: { body?: unknown; ip?: string } = {}): Request {
  const address = keypair.publicKey();
  const exp = Date.now() + 60_000;
  const payload = Buffer.concat([
    Buffer.from("Stellar Signed Message:\n", "utf8"),
    Buffer.from(authMessage(address, exp, "POST", path), "utf8"),
  ]);
  const signature = keypair.sign(createHash("sha256").update(payload).digest()).toString("base64");
  const headers: Record<string, string> = { [PROOF_HEADER]: JSON.stringify({ address, exp, signature }) };
  if (options.ip) headers["x-forwarded-for"] = options.ip;
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function withPatchedEnvAndFetch<T>(
  env: Record<string, string | undefined>,
  fakeFetch: typeof fetch,
  run: () => Promise<T>,
): Promise<T> {
  const savedEnv: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    savedEnv[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const savedFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = savedFetch;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("fund route: second call for a funded wallet does not reach Pollar; the 4th failing try is a 429", async () => {
  resetFundState();
  let pollarCalls = 0;
  const fakeFetch = (async () => {
    pollarCalls += 1;
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  await withPatchedEnvAndFetch({ POLLAR_SECRET_KEY: "sec_testnet_fake" }, fakeFetch, async () => {
    const funded = Keypair.random();
    for (let i = 0; i < 5; i += 1) {
      const res = await fundRoute(signedRequest(funded, "/api/wallet/fund", { ip: "7.7.7.7" }));
      assert.equal(res.status, 200);
    }
    assert.equal(pollarCalls, 1);
  });

  resetFundState();
  const failing = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
  await withPatchedEnvAndFetch({ POLLAR_SECRET_KEY: "sec_testnet_fake" }, failing, async () => {
    const keypair = Keypair.random();
    const statuses: number[] = [];
    for (let i = 0; i < FUND_WALLET_LIMIT + 1; i += 1) {
      const res = await fundRoute(signedRequest(keypair, "/api/wallet/fund", { ip: "8.8.8.8" }));
      statuses.push(res.status);
      if (res.status === 429) {
        assert.ok(Number(res.headers.get("retry-after")) > 0);
        assert.equal(((await res.json()) as { code: string }).code, "rate_limited");
      }
    }
    assert.deepEqual(statuses, [502, 502, 502, 429]);
  });
});

test("fund route: still refuses a mainnet key and a missing key before anything else", async () => {
  resetFundState();
  const never = (async () => {
    throw new Error("must not be called");
  }) as unknown as typeof fetch;
  await withPatchedEnvAndFetch({ POLLAR_SECRET_KEY: undefined }, never, async () => {
    const res = await fundRoute(signedRequest(Keypair.random(), "/api/wallet/fund"));
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { code: string }).code, "secret_missing");
  });
  await withPatchedEnvAndFetch({ POLLAR_SECRET_KEY: "sec_live_fake" }, never, async () => {
    const res = await fundRoute(signedRequest(Keypair.random(), "/api/wallet/fund"));
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { code: string }).code, "not_testnet");
  });
});

// ---------------------------------------------------------------- x routes

const X_SECRET = "test-secret-not-real-0123456789";

test("x/challenge: 20 per wallet per hour, then 429 with Retry-After", async () => {
  resetXLimits();
  await withPatchedEnvAndFetch({ X_CHALLENGE_SECRET: X_SECRET }, fetch, async () => {
    const keypair = Keypair.random();
    for (let i = 0; i < X_CHALLENGE_WALLET_LIMIT; i += 1) {
      const res = await challengeRoute(signedRequest(keypair, "/api/x/challenge", { ip: "9.9.9.1" }));
      assert.equal(res.status, 200, `call ${i + 1}`);
    }
    const denied = await challengeRoute(signedRequest(keypair, "/api/x/challenge", { ip: "9.9.9.1" }));
    assert.equal(denied.status, 429);
    assert.ok(Number(denied.headers.get("retry-after")) > 0);
    assert.equal(((await denied.json()) as { code: string }).code, "rate_limited");
    // A different wallet from another IP is not affected.
    const other = await challengeRoute(signedRequest(Keypair.random(), "/api/x/challenge", { ip: "9.9.9.2" }));
    assert.equal(other.status, 200);
  });
});

test("x/verify: 10 per wallet per hour (only well-formed requests count), then 429", async () => {
  resetXLimits();
  let oembedCalls = 0;
  const fakeFetch = (async () => {
    oembedCalls += 1;
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  await withPatchedEnvAndFetch({ X_CHALLENGE_SECRET: X_SECRET, NEXT_PUBLIC_SUPABASE_URL: undefined }, fakeFetch, async () => {
    const keypair = Keypair.random();
    // Malformed bodies do not spend the budget.
    for (let i = 0; i < 15; i += 1) {
      const res = await verifyRoute(signedRequest(keypair, "/api/x/verify", { body: {}, ip: "9.9.8.1" }));
      assert.equal(res.status, 400);
    }
    for (let i = 0; i < X_VERIFY_WALLET_LIMIT; i += 1) {
      const res = await verifyRoute(
        signedRequest(keypair, "/api/x/verify", { body: { url: "https://x.com/jack/status/20" }, ip: "9.9.8.1" }),
      );
      assert.equal(res.status, 404, `call ${i + 1}`);
    }
    assert.equal(oembedCalls, X_VERIFY_WALLET_LIMIT);
    const denied = await verifyRoute(
      signedRequest(keypair, "/api/x/verify", { body: { url: "https://x.com/jack/status/20" }, ip: "9.9.8.1" }),
    );
    assert.equal(denied.status, 429);
    assert.ok(Number(denied.headers.get("retry-after")) > 0);
    assert.equal(oembedCalls, X_VERIFY_WALLET_LIMIT, "no extra call to X once limited");
  });
});
