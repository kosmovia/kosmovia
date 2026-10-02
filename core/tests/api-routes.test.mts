/**
 * The REST routes of the api backend, end to end except for the database: a fake
 * pool stands in for Postgres (no network, no real DB), so what is checked is
 * the gate, the session, the authorization and what reaches the SQL.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test, { afterEach } from "node:test";
import { Keypair } from "@stellar/stellar-base";

import { GET as sessionGet, POST as sessionPost } from "../app/api/auth/session/route.ts";
import { POST as logoutPost } from "../app/api/auth/logout/route.ts";
import { GET as messagesGet, POST as messagesPost } from "../app/api/channels/[id]/messages/route.ts";
import { GET as communitiesGet, POST as communitiesPost } from "../app/api/communities/route.ts";
import { POST as channelsPost } from "../app/api/communities/[slug]/channels/route.ts";
import { GET as communityGet } from "../app/api/communities/[slug]/route.ts";
import { GET as profileGet, PATCH as profilePatch, POST as profilePost } from "../app/api/profile/route.ts";
import { authMessage, PROOF_HEADER } from "../lib/auth-message.ts";
import { resetApiLimits } from "../lib/api-limits.ts";
import * as repo from "../lib/db/repo.ts";
import { profileIdFromWallet } from "../lib/ids.ts";
import { SESSION_COOKIE, signSessionCookie, verifySessionCookie } from "../lib/session-cookie.ts";

const POOL_KEY = Symbol.for("kosmovia.pg.pool");
const SECRET = randomBytes(24).toString("hex"); // 48 chars, made up for this run
const CHANNEL = "11111111-1111-4111-8111-111111111111";
const COMMUNITY = "22222222-2222-4222-8222-222222222222";

const alice = Keypair.random();
const bob = Keypair.random();

type Call = { text: string; values: unknown[] };
type Handler = (text: string, values: unknown[]) => unknown[] | Error;

function installPool(handler: Handler): Call[] {
  const calls: Call[] = [];
  (globalThis as Record<symbol, unknown>)[POOL_KEY] = {
    async query(text: string, values: unknown[]) {
      calls.push({ text, values });
      const out = handler(text, values);
      if (out instanceof Error) throw out;
      return { rows: out };
    },
  };
  return calls;
}

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[POOL_KEY];
  resetApiLimits();
});

function withEnv(values: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  return async () => {
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(values)) {
      saved[k] = process.env[k];
      if (values[k] === undefined) delete process.env[k];
      else process.env[k] = values[k];
    }
    try {
      await fn();
    } finally {
      for (const k of Object.keys(saved)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  };
}

/** Env of a configured api backend. The URL is a placeholder: the pool is faked, nothing ever connects. */
const API_ENV = {
  KOSMOVIA_DATA_BACKEND: "api",
  DATABASE_URL: "postgresql://u:p@localhost:5432/test",
  SESSION_SECRET: SECRET,
};

const cookieFor = (kp: Keypair) =>
  `${SESSION_COOKIE}=${signSessionCookie({ secret: Buffer.from(SECRET), wallet: kp.publicKey() }).token}`;

function req(path: string, opts: { method?: string; cookie?: string; body?: unknown; headers?: Record<string, string> } = {}): Request {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://kosmovia.test${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

function proofRequest(kp: Keypair, method = "POST", path = "/api/auth/session"): Request {
  const exp = Date.now() + 60_000;
  const message = authMessage(kp.publicKey(), exp, method, path);
  const payload = Buffer.concat([Buffer.from("Stellar Signed Message:\n"), Buffer.from(message)]);
  const signature = kp.sign(createHash("sha256").update(payload).digest()).toString("base64");
  return new Request(`https://kosmovia.test${path}`, {
    method,
    headers: { [PROOF_HEADER]: JSON.stringify({ address: kp.publicKey(), exp, signature }) },
  });
}

// ------------------------------------------------------------------- session

test(
  "api backend: POST /api/auth/session sets an httpOnly cookie and puts no token in the body",
  withEnv({ ...API_ENV, NODE_ENV: "production" }, async () => {
    const res = await sessionPost(proofRequest(alice));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ["address", "backend", "expiresAt", "profileId"]);
    assert.equal(body.backend, "api");
    assert.equal(body.address, alice.publicKey());
    assert.equal(body.profileId, profileIdFromWallet(alice.publicKey()));
    assert.ok(body.expiresAt > Date.now() + 11 * 3600_000 && body.expiresAt <= Date.now() + 12 * 3600_000 + 5_000);

    const setCookie = res.headers.get("set-cookie") ?? "";
    for (const attr of ["HttpOnly", "SameSite=Lax", "Secure", "Path=/", "Max-Age=43200"]) assert.ok(setCookie.includes(attr), attr);
    const token = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(setCookie)?.[1] ?? "";
    assert.ok(!JSON.stringify(body).includes(token));
    const verified = verifySessionCookie(token, Buffer.from(SECRET));
    assert.equal(verified.ok, true);
    if (verified.ok) {
      assert.equal(verified.claims.wallet, alice.publicKey());
      assert.equal(verified.claims.sub, body.profileId);
    }
  }),
);

test(
  "api backend: the cookie is not Secure outside production (next dev runs on http)",
  withEnv({ ...API_ENV, NODE_ENV: "development" }, async () => {
    const res = await sessionPost(proofRequest(alice));
    assert.equal(res.status, 200);
    assert.ok(!(res.headers.get("set-cookie") ?? "").includes("Secure"));
  }),
);

test(
  "api backend: without a good SESSION_SECRET the session answers 503 and sets no cookie",
  async () => {
    for (const secret of [undefined, "", "too-short"]) {
      await withEnv({ ...API_ENV, SESSION_SECRET: secret }, async () => {
        const res = await sessionPost(proofRequest(alice));
        assert.equal(res.status, 503);
        assert.equal((await res.json()).code, "session_not_configured");
        assert.equal(res.headers.get("set-cookie"), null);
      })();
    }
  },
);

test(
  "api backend: a bad proof gets no cookie",
  withEnv(API_ENV, async () => {
    const res = await sessionPost(new Request("https://kosmovia.test/api/auth/session", { method: "POST" }));
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("set-cookie"), null);
  }),
);

test(
  "GET /api/auth/session reads the cookie back, and logout clears it",
  withEnv(API_ENV, async () => {
    const ok = await sessionGet(req("/api/auth/session", { cookie: cookieFor(alice) }));
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).address, alice.publicKey());
    assert.equal((await sessionGet(req("/api/auth/session"))).status, 401);

    const out = await logoutPost(req("/api/auth/logout", { method: "POST" }));
    assert.equal(out.status, 200);
    const cleared = out.headers.get("set-cookie") ?? "";
    assert.ok(cleared.startsWith(`${SESSION_COOKIE}=;`) && cleared.includes("Max-Age=0"));
    const foreign = await logoutPost(req("/api/auth/logout", { method: "POST", headers: { origin: "https://evil.test" } }));
    assert.equal(foreign.status, 403);
  }),
);

// ---------------------------------------------------------------------- gate

test(
  "backend not api: every REST route is off (404), and GET /api/auth/session too",
  withEnv({ KOSMOVIA_DATA_BACKEND: undefined, DATABASE_URL: API_ENV.DATABASE_URL, SESSION_SECRET: SECRET }, async () => {
    for (const res of [
      await profileGet(req("/api/profile", { cookie: cookieFor(alice) })),
      await communitiesGet(req("/api/communities")),
      await messagesGet(req(`/api/channels/${CHANNEL}/messages`, { cookie: cookieFor(alice) }), ctx({ id: CHANNEL })),
      await sessionGet(req("/api/auth/session", { cookie: cookieFor(alice) })),
    ]) {
      assert.equal(res.status, 404);
      assert.equal((await res.json()).code, "backend_disabled");
    }
  }),
);

test(
  "api backend without DATABASE_URL: 503 db_not_configured on every route",
  withEnv({ ...API_ENV, DATABASE_URL: undefined }, async () => {
    const cookie = cookieFor(alice);
    const answers = [
      await profileGet(req("/api/profile", { cookie })),
      await profilePost(req("/api/profile", { method: "POST", cookie, body: { username: "abc" } })),
      await communitiesGet(req("/api/communities")),
      await communitiesPost(req("/api/communities", { method: "POST", cookie, body: { name: "Ok", slug: "ok-slug" } })),
      await communityGet(req("/api/communities/ok-slug"), ctx({ slug: "ok-slug" })),
      await messagesGet(req(`/api/channels/${CHANNEL}/messages`, { cookie }), ctx({ id: CHANNEL })),
      await messagesPost(req(`/api/channels/${CHANNEL}/messages`, { method: "POST", cookie, body: { content: "hi" } }), ctx({ id: CHANNEL })),
    ];
    for (const res of answers) {
      assert.equal(res.status, 503);
      assert.equal((await res.json()).code, "db_not_configured");
    }
  }),
);

test(
  "api backend: no cookie, a forged cookie or a foreign origin never reach the database",
  withEnv(API_ENV, async () => {
    const calls = installPool(() => []);
    const none = await profileGet(req("/api/profile"));
    assert.equal(none.status, 401);
    const forged = await profileGet(req("/api/profile", { cookie: `${SESSION_COOKIE}=aaa.bbb.ccc` }));
    assert.equal(forged.status, 401);
    const wrongSecret = signSessionCookie({ secret: Buffer.from(randomBytes(40).toString("hex")), wallet: alice.publicKey() }).token;
    assert.equal((await profileGet(req("/api/profile", { cookie: `${SESSION_COOKIE}=${wrongSecret}` }))).status, 401);
    const cross = await profilePost(
      req("/api/profile", { method: "POST", cookie: cookieFor(alice), body: { username: "abc" }, headers: { origin: "https://evil.test" } }),
    );
    assert.equal(cross.status, 403);
    assert.equal(calls.length, 0);
  }),
);

// ------------------------------------------------------------ authorization

const memberRow = (role: string | null, type = "text") => [{ id: CHANNEL, community_id: COMMUNITY, type, role }];
const messageRow = (authorId: string) => ({
  id: "33333333-3333-4333-8333-333333333333",
  channel_id: CHANNEL,
  author_id: authorId,
  content: "hola",
  created_at: "2026-10-02T00:00:00.000000Z",
  author: { id: authorId, username: "prueba", display_name: "P", avatar_seed: "s", avatar_style: "planet" },
});

test(
  "messages: a non-member is denied reading and the messages query never runs",
  withEnv(API_ENV, async () => {
    const calls = installPool((text) => (text.includes("left join public.members") ? memberRow(null) : []));
    const res = await messagesGet(req(`/api/channels/${CHANNEL}/messages`, { cookie: cookieFor(bob) }), ctx({ id: CHANNEL }));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, "not_member");
    assert.equal(calls.length, 1);
    assert.ok(!calls.some((c) => c.text.includes("from public.messages m")));
  }),
);

test(
  "messages: a member reads oldest first, with the profile of the session as the only identity used",
  withEnv(API_ENV, async () => {
    const aliceId = profileIdFromWallet(alice.publicKey());
    const first = messageRow(aliceId);
    const second = { ...messageRow(aliceId), id: "44444444-4444-4444-8444-444444444444" };
    // The database answers newest first (a fresh array each time, the route reverses it).
    const calls = installPool((text) => (text.includes("left join public.members") ? memberRow("member") : [second, first]));
    const res = await messagesGet(req(`/api/channels/${CHANNEL}/messages?limit=2`, { cookie: cookieFor(alice) }), ctx({ id: CHANNEL }));
    assert.equal(res.status, 200);
    const body = await res.json();
    // The query is newest first; the route hands it back oldest first.
    assert.deepEqual(body.messages.map((m: { id: string }) => m.id), [first.id, second.id]);
    assert.deepEqual(calls[0].values, [CHANNEL, aliceId]);
    assert.equal(calls[1].values[0], CHANNEL);
    assert.equal(calls[1].values[1], 2);
  }),
);

test(
  "messages: a bad cursor or a bad channel id is a 400/404 before any query",
  withEnv(API_ENV, async () => {
    const calls = installPool(() => []);
    const cookie = cookieFor(alice);
    assert.equal((await messagesGet(req(`/api/channels/${CHANNEL}/messages?after=nope`, { cookie }), ctx({ id: CHANNEL }))).status, 400);
    assert.equal((await messagesGet(req("/api/channels/not-a-uuid/messages", { cookie }), ctx({ id: "not-a-uuid" }))).status, 404);
    assert.equal(calls.length, 0);
  }),
);

test(
  "messages: a member cannot post in #anuncios, and no INSERT is attempted",
  withEnv(API_ENV, async () => {
    const calls = installPool((text) => (text.includes("left join public.members") ? memberRow("member", "announcement") : []));
    const res = await messagesPost(
      req(`/api/channels/${CHANNEL}/messages`, { method: "POST", cookie: cookieFor(alice), body: { content: "hola" } }),
      ctx({ id: CHANNEL }),
    );
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, "announcement_readonly");
    assert.ok(!calls.some((c) => c.text.includes("insert into public.messages")));
  }),
);

test(
  "messages: an owner can post in #anuncios; the author is the session profile, whatever the body says",
  withEnv(API_ENV, async () => {
    const aliceId = profileIdFromWallet(alice.publicKey());
    const calls = installPool((text) => {
      if (text.includes("left join public.members")) return memberRow("owner", "announcement");
      if (text.includes("insert into public.messages")) return [messageRow(aliceId)];
      return [];
    });
    const res = await messagesPost(
      req(`/api/channels/${CHANNEL}/messages`, {
        method: "POST",
        cookie: cookieFor(alice),
        body: { content: "  hola  ", author_id: profileIdFromWallet(bob.publicKey()), channel_id: "other" },
      }),
      ctx({ id: CHANNEL }),
    );
    assert.equal(res.status, 201);
    assert.equal((await res.json()).message.author_id, aliceId);
    const insert = calls.find((c) => c.text.includes("insert into public.messages"));
    assert.deepEqual(insert?.values, [CHANNEL, aliceId, "hola"]);
  }),
);

test(
  "messages: a non-member is denied posting; a quota trigger error becomes a 429 in Spanish",
  withEnv(API_ENV, async () => {
    installPool((text) => (text.includes("left join public.members") ? memberRow(null) : []));
    const denied = await messagesPost(
      req(`/api/channels/${CHANNEL}/messages`, { method: "POST", cookie: cookieFor(bob), body: { content: "hola" } }),
      ctx({ id: CHANNEL }),
    );
    assert.equal(denied.status, 403);

    installPool((text) =>
      text.includes("left join public.members")
        ? memberRow("member")
        : Object.assign(new Error("quota_exceeded:messages_per_minute"), { code: "P0001" }),
    );
    const limited = await messagesPost(
      req(`/api/channels/${CHANNEL}/messages`, { method: "POST", cookie: cookieFor(alice), body: { content: "hola" } }),
      ctx({ id: CHANNEL }),
    );
    assert.equal(limited.status, 429);
    const body = await limited.json();
    assert.equal(body.code, "quota_exceeded");
    assert.match(body.error, /Vas muy rápido/);
  }),
);

test(
  "messages: an unknown channel is a 404",
  withEnv(API_ENV, async () => {
    installPool(() => []);
    const res = await messagesPost(
      req(`/api/channels/${CHANNEL}/messages`, { method: "POST", cookie: cookieFor(alice), body: { content: "hola" } }),
      ctx({ id: CHANNEL }),
    );
    assert.equal(res.status, 404);
  }),
);

test(
  "channels: a plain member cannot create one; the body is validated first",
  withEnv(API_ENV, async () => {
    const calls = installPool((text) => (text.includes("from public.communities c") ? [{ id: COMMUNITY, slug: "ok-slug" }] : text.includes("select role") ? [{ role: "member" }] : []));
    const cookie = cookieFor(alice);
    const denied = await channelsPost(req("/api/communities/ok-slug/channels", { method: "POST", cookie, body: { name: "ideas" } }), ctx({ slug: "ok-slug" }));
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, "not_admin");
    assert.ok(!calls.some((c) => c.text.includes("insert into public.channels")));
    const bad = await channelsPost(req("/api/communities/ok-slug/channels", { method: "POST", cookie, body: { name: "Bad Name" } }), ctx({ slug: "ok-slug" }));
    assert.equal(bad.status, 400);
  }),
);

test(
  "profile: the id and wallet come from the session; trust and X columns are never in the SQL",
  withEnv(API_ENV, async () => {
    const aliceId = profileIdFromWallet(alice.publicKey());
    const row = { id: aliceId, wallet: alice.publicKey(), username: "prueba_kosmo", display_name: "", avatar_seed: "s", avatar_style: "planet", bio: null, trust_level: 0, x_handle: null };
    const calls = installPool((text) => (text.includes("insert into public.profiles") || text.includes("update public.profiles") ? [row] : []));
    const cookie = cookieFor(alice);
    const created = await profilePost(
      req("/api/profile", {
        method: "POST",
        cookie,
        body: { username: "@Prueba_Kosmo", avatarSeed: "s", avatarStyle: "planet", id: "x", wallet: "GEVIL", trust_level: 2 },
      }),
    );
    assert.equal(created.status, 201);
    const insert = calls.find((c) => c.text.includes("insert into public.profiles"));
    assert.deepEqual(insert?.values.slice(0, 3), [aliceId, alice.publicKey(), "prueba_kosmo"]);
    assert.ok(!insert?.values.includes("GEVIL") && !insert?.values.includes(2));

    const patched = await profilePatch(req("/api/profile", { method: "PATCH", cookie, body: { bio: "hola", trust_level: 2 } }));
    assert.equal(patched.status, 200);
    const update = calls.find((c) => c.text.includes("update public.profiles"));
    assert.deepEqual(update?.values, [aliceId, "hola"]);
    assert.equal((await profilePatch(req("/api/profile", { method: "PATCH", cookie, body: { trust_level: 2 } }))).status, 400);
  }),
);

test(
  "profile: a taken @usuario is a 409 username_taken, never a raw database error",
  withEnv(API_ENV, async () => {
    installPool(() => Object.assign(new Error('duplicate key value violates unique constraint "profiles_username_lower_key"'), { code: "23505", constraint: "profiles_username_lower_key" }));
    const res = await profilePost(req("/api/profile", { method: "POST", cookie: cookieFor(alice), body: { username: "tomado" } }));
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "username_taken");
    assert.ok(!JSON.stringify(body).includes("duplicate key"));
  }),
);

test(
  "communities: public list works without a cookie; creating needs one, and the owner is the session profile",
  withEnv(API_ENV, async () => {
    const aliceId = profileIdFromWallet(alice.publicKey());
    const community = { id: COMMUNITY, slug: "prueba-kosmovia", name: "Prueba Kosmovia", icon: "", description: "", owner_id: aliceId };
    const calls = installPool((text) => (text.includes("insert into public.communities") || text.includes("from public.communities c") ? [community] : []));
    const list = await communitiesGet(req("/api/communities"));
    assert.equal(list.status, 200);
    assert.deepEqual((await list.json()).mine, []);
    assert.equal((await communitiesPost(req("/api/communities", { method: "POST", body: { name: "Ok", slug: "ok-slug" } }))).status, 401);
    const created = await communitiesPost(
      req("/api/communities", { method: "POST", cookie: cookieFor(alice), body: { name: "Prueba Kosmovia", slug: "prueba-kosmovia", owner_id: "someone" } }),
    );
    assert.equal(created.status, 201);
    const insert = calls.find((c) => c.text.includes("insert into public.communities"));
    assert.equal(insert?.values[4], aliceId);
    assert.ok(!insert?.values.includes("someone"));
  }),
);

test(
  "writes are rate limited per profile with a 429 and Retry-After",
  withEnv(API_ENV, async () => {
    installPool(() => [{ id: COMMUNITY }]);
    const cookie = cookieFor(alice);
    let last: Response | null = null;
    for (let i = 0; i < 25; i += 1) {
      last = await profilePatch(req("/api/profile", { method: "PATCH", cookie, body: { bio: `b${i}` } }));
      if (last.status === 429) break;
    }
    assert.equal(last?.status, 429);
    assert.ok(Number(last?.headers.get("retry-after")) >= 1);
    // Another profile is unaffected.
    assert.notEqual((await profilePatch(req("/api/profile", { method: "PATCH", cookie: cookieFor(bob), body: { bio: "x" } }))).status, 429);
  }),
);

// ----------------------------------------------------------------------- X

test(
  "X verification in api mode: level 1 through the repo, unique handle, a missing profile is reported",
  withEnv(API_ENV, async () => {
    const id = profileIdFromWallet(alice.publicKey());
    const opts = { profileId: id, wallet: alice.publicKey(), handle: "prueba", verifiedAt: "2026-10-02T00:00:00.000Z" };

    const ok = installPool((text) => (text.includes("update public.profiles") ? [{ id }] : []));
    assert.deepEqual(await repo.persistXVerification(opts), { persisted: true });
    assert.deepEqual(ok[0].values, [id, alice.publicKey(), "prueba", opts.verifiedAt]);
    assert.match(ok[0].text, /trust_level = 1/);
    assert.match(ok[0].text, /trust_level < 2/);

    installPool(() => []);
    assert.deepEqual(await repo.persistXVerification(opts), { persisted: false, reason: "no_profile" });

    // Updated nothing, but the profile exists: it is level 2 (left alone).
    installPool((text) => (text.includes("select trust_level") ? [{ trust_level: 2 }] : []));
    assert.deepEqual(await repo.persistXVerification(opts), { persisted: false, reason: "error" });

    installPool(() => Object.assign(new Error("dup"), { code: "23505", constraint: "profiles_x_handle_lower_key" }));
    await assert.rejects(repo.persistXVerification(opts), (err: { code?: string }) => err.code === "23505");
  }),
);
