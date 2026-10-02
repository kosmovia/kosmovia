/**
 * Persisting an X verification through the `kosmovia_verifier` role: the token,
 * the PostgREST request, every outcome (saved, no profile, handle taken, error,
 * not configured) and the full /api/x/verify route. Supabase and X are replaced
 * by injected or patched fetch; the signing key is generated here.
 */
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { Keypair } from "@stellar/stellar-base";

import { POST as verifyRoute } from "../app/api/x/verify/route.ts";
import { authMessage, PROOF_HEADER } from "../lib/auth-message.ts";
import { profileIdFromWallet } from "../lib/ids.ts";
import {
  signSessionJwt,
  signVerifierJwt,
  verifySessionJwt,
  VERIFIER_ROLE,
  VERIFIER_SUB,
  VERIFIER_TTL_SECONDS,
} from "../lib/jwt.ts";
import { resetXLimits } from "../lib/x-limits.ts";
import { persistXVerification, readPersistConfig, type Fetcher } from "../lib/x-persist.ts";
import { challengeFor } from "../lib/x-verify.ts";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.test/",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-not-real",
  SUPABASE_JWT_PRIVATE_KEY: PEM,
  SUPABASE_JWT_KEY_ID: "kid-persist",
};
const WALLET = Keypair.random().publicKey();
const VERIFIED_AT = "2026-10-01T12:00:00.000Z";

// -------------------------------------------------------------------- token

test("verifier token: role kosmovia_verifier, 2 minutes, same ES256 key, useless as a session", () => {
  const now = Date.UTC(2026, 9, 1, 12, 0, 0);
  const { token, claims, expiresAt } = signVerifierJwt({ privateKeyPem: PEM, keyId: "kid-1", now });
  assert.equal(claims.role, VERIFIER_ROLE);
  assert.equal(VERIFIER_ROLE, "kosmovia_verifier");
  assert.equal(claims.exp - claims.iat, 120);
  assert.equal(VERIFIER_TTL_SECONDS, 120);
  assert.equal(expiresAt, claims.exp * 1000);
  assert.equal(claims.sub, VERIFIER_SUB);
  assert.equal(claims.aud, "authenticated");

  const [h, p] = token.split(".");
  const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
  assert.deepEqual(header, { alg: "ES256", typ: "JWT", kid: "kid-1" });
  assert.equal(JSON.parse(Buffer.from(p, "base64url").toString("utf8")).role, "kosmovia_verifier");

  // verifySessionJwt only accepts role `authenticated`: the verifier token is not a session.
  const asSession = verifySessionJwt(token, publicKey, now + 1000);
  assert.equal(asSession.ok, false);
  if (!asSession.ok) assert.equal(asSession.reason, "claims");
  // And a session token does not carry the verifier role.
  const session = signSessionJwt({ privateKeyPem: PEM, keyId: "kid-1", profileId: profileIdFromWallet(WALLET), wallet: WALLET, now });
  assert.equal(session.claims.role, "authenticated");
});

// ------------------------------------------------------------------ persist

type Seen = { url: string; init: RequestInit };

function respondWith(status: number, body: unknown): { fetcher: Fetcher; seen: Seen[] } {
  const seen: Seen[] = [];
  return {
    seen,
    fetcher: async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    },
  };
}

const persist = (fetcher: Fetcher, env: Record<string, string | undefined> = ENV) =>
  persistXVerification({ wallet: WALLET, handle: "jack", verifiedAt: VERIFIED_AT, env, fetcher });

test("persist sends one PATCH to PostgREST as the verifier role, for this wallet's row only", async () => {
  const { fetcher, seen } = respondWith(200, [{ id: profileIdFromWallet(WALLET) }]);
  const result = await persist(fetcher);
  assert.deepEqual(result, { persisted: true });
  assert.equal(seen.length, 1);

  const { url, init } = seen[0];
  const id = profileIdFromWallet(WALLET);
  assert.equal(
    url,
    `https://abcd.supabase.test/rest/v1/profiles?id=eq.${id}&wallet=eq.${WALLET}&select=id`,
  );
  assert.equal(init.method, "PATCH");
  const headers = init.headers as Record<string, string>;
  assert.equal(headers.apikey, "anon-key-not-real");
  assert.equal(headers.Prefer, "return=representation");
  assert.match(headers.Authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  const claims = JSON.parse(Buffer.from(headers.Authorization.split(".")[1], "base64url").toString("utf8"));
  assert.equal(claims.role, "kosmovia_verifier");
  assert.equal(claims.exp - claims.iat, 120);
  assert.deepEqual(JSON.parse(String(init.body)), { x_handle: "jack", x_verified_at: VERIFIED_AT, trust_level: 1 });
  // Never a service_role anywhere.
  assert.ok(!JSON.stringify(init).includes("service_role"));
});

test("persist: no row updated means no profile yet", async () => {
  const result = await persist(respondWith(200, []).fetcher);
  assert.deepEqual(result, { persisted: false, reason: "no_profile" });
});

test("persist: a unique violation (409 / 23505) is x_taken", async () => {
  const dup = { code: "23505", message: 'duplicate key value violates unique constraint "profiles_x_handle_lower_key"' };
  assert.deepEqual(await persist(respondWith(409, dup).fetcher), { persisted: false, reason: "x_taken" });
  // Whatever the HTTP status, the Postgres code decides.
  assert.deepEqual(await persist(respondWith(400, dup).fetcher), { persisted: false, reason: "x_taken" });
});

test("persist: other failures are a generic error, never a throw", async () => {
  assert.deepEqual(await persist(respondWith(403, { code: "42501", message: "denied" }).fetcher), {
    persisted: false,
    reason: "error",
  });
  assert.deepEqual(await persist(respondWith(500, "oops").fetcher), { persisted: false, reason: "error" });
  const unreachable: Fetcher = async () => {
    throw new Error("network down");
  };
  assert.deepEqual(await persist(unreachable), { persisted: false, reason: "error" });
});

test("persist: without Supabase configured it does nothing and says so", async () => {
  const never: Fetcher = async () => {
    throw new Error("must not be called");
  };
  for (const missing of Object.keys(ENV)) {
    const env = { ...ENV, [missing]: undefined };
    assert.deepEqual(await persist(never, env), { persisted: false, reason: "not_configured" }, missing);
  }
  assert.equal(readPersistConfig(ENV).ok, true);
  assert.deepEqual(readPersistConfig({}), { ok: false });
  // A malformed key is "not configured" too, and the reason is not echoed.
  assert.deepEqual(await persist(never, { ...ENV, SUPABASE_JWT_PRIVATE_KEY: "not a pem" }), {
    persisted: false,
    reason: "not_configured",
  });
});

// -------------------------------------------------------------------- route

const ORIGIN = "https://kosmovia.test";
const X_SECRET = "test-secret-not-real-0123456789";

function signedVerifyRequest(keypair: Keypair, url: string): Request {
  const address = keypair.publicKey();
  const exp = Date.now() + 60_000;
  const path = "/api/x/verify";
  const payload = Buffer.concat([
    Buffer.from("Stellar Signed Message:\n", "utf8"),
    Buffer.from(authMessage(address, exp, "POST", path), "utf8"),
  ]);
  const signature = keypair.sign(createHash("sha256").update(payload).digest()).toString("base64");
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { [PROOF_HEADER]: JSON.stringify({ address, exp, signature }), "x-forwarded-for": "10.1.1.1" },
    body: JSON.stringify({ url }),
  });
}

/** Fake X (oEmbed with the wallet's real code) and fake Supabase answering `supabase`. */
function fakeNetwork(keypair: Keypair, supabase: () => Response): { fetch: typeof fetch; supabaseCalls: string[] } {
  const supabaseCalls: string[] = [];
  const code = challengeFor(X_SECRET, keypair.publicKey(), Date.now()).code;
  const fake = (async (input: unknown) => {
    const url = String(input);
    if (url.startsWith("https://publish.x.com/oembed")) {
      return new Response(
        JSON.stringify({
          author_url: "https://x.com/jack",
          html: `<blockquote class="twitter-tweet"><p lang="es" dir="ltr">Verifico mi cuenta en Kosmovia kosmovia:${code}</p>&mdash; Jack (@jack) <a href="https://x.com/jack/status/20">1 de octubre</a></blockquote>`,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.startsWith("https://abcd.supabase.test/")) {
      supabaseCalls.push(url);
      return supabase();
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
  return { fetch: fake, supabaseCalls };
}

async function withEnvAndFetch<T>(env: Record<string, string | undefined>, fake: typeof fetch, run: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const savedFetch = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await run();
  } finally {
    globalThis.fetch = savedFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const POST_URL = "https://x.com/jack/status/20";
const routeEnv = { ...ENV, X_CHALLENGE_SECRET: X_SECRET };

test("verify route: verified and saved answers persisted:true", async () => {
  resetXLimits();
  const keypair = Keypair.random();
  const net = fakeNetwork(keypair, () => new Response(JSON.stringify([{ id: "row" }]), { status: 200 }));
  await withEnvAndFetch(routeEnv, net.fetch, async () => {
    const res = await verifyRoute(signedVerifyRequest(keypair, POST_URL));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { handle: string; verifiedAt: string; persisted: boolean };
    assert.equal(body.handle, "jack");
    assert.equal(body.persisted, true);
    assert.ok(Date.parse(body.verifiedAt) > 0);
    assert.equal(net.supabaseCalls.length, 1);
    assert.ok(net.supabaseCalls[0].includes(`wallet=eq.${keypair.publicKey()}`));
  });
});

test("verify route: a handle linked to another profile is 409 x_taken in Spanish", async () => {
  resetXLimits();
  const keypair = Keypair.random();
  const net = fakeNetwork(keypair, () => new Response(JSON.stringify({ code: "23505", message: "duplicate" }), { status: 409 }));
  await withEnvAndFetch(routeEnv, net.fetch, async () => {
    const res = await verifyRoute(signedVerifyRequest(keypair, POST_URL));
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: "Esa cuenta de X ya está vinculada a otro perfil", code: "x_taken" });
  });
});

test("verify route: no profile yet is persisted:false with its reason", async () => {
  resetXLimits();
  const keypair = Keypair.random();
  const net = fakeNetwork(keypair, () => new Response("[]", { status: 200 }));
  await withEnvAndFetch(routeEnv, net.fetch, async () => {
    const res = await verifyRoute(signedVerifyRequest(keypair, POST_URL));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { persisted: boolean; persistReason: string; handle: string };
    assert.deepEqual([body.handle, body.persisted, body.persistReason], ["jack", false, "no_profile"]);
  });
});

test("verify route: without Supabase configured it still returns the result with persisted:false", async () => {
  resetXLimits();
  const keypair = Keypair.random();
  const net = fakeNetwork(keypair, () => {
    throw new Error("Supabase must not be called");
  });
  const env = { ...routeEnv, NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined };
  await withEnvAndFetch(env, net.fetch, async () => {
    const res = await verifyRoute(signedVerifyRequest(keypair, POST_URL));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { persisted: boolean; persistReason: string; handle: string };
    assert.deepEqual([body.handle, body.persisted, body.persistReason], ["jack", false, "not_configured"]);
    assert.equal(net.supabaseCalls.length, 0);
  });
});
