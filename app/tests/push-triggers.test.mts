/**
 * Disparadores de push en las rutas de mensajes (pool falso, sin red ni base de datos):
 * un mensaje directo avisa al otro participante, una mención avisa a miembros que ven el
 * canal, nunca al autor, y con el push apagado no hay consultas de más.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { afterEach } from "node:test";
import { Keypair } from "@stellar/stellar-base";
import webpush from "web-push";

import { POST as channelPost } from "../app/api/channels/[id]/messages/route.ts";
import { POST as dmPost } from "../app/api/dms/[id]/messages/route.ts";
import { resetApiLimits } from "../lib/core/api-limits.ts";
import { profileIdFromWallet } from "../lib/core/ids.ts";
import { SESSION_COOKIE, signSessionCookie } from "../lib/core/session-cookie.ts";

const SECRET = randomBytes(24).toString("hex");
const SECRET_BYTES = Buffer.from(SECRET);
const ALICE = Keypair.random().publicKey();
const aliceId = profileIdFromWallet(ALICE);
const BOB_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CAROL_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const THREAD = "11111111-1111-4111-8111-111111111111";
const CHANNEL = "22222222-2222-4222-8222-222222222222";
const COMMUNITY = "33333333-3333-4333-8333-333333333333";

const POOL_KEY = Symbol.for("kosmovia.pg.pool");
type Call = { text: string; values: unknown[] };

function installPool(handler: (text: string, values: unknown[]) => unknown[]): Call[] {
  const calls: Call[] = [];
  const run = async (text: string, values?: unknown[]) => {
    calls.push({ text, values: values ?? [] });
    return { rows: handler(text, values ?? []) };
  };
  (globalThis as Record<symbol, unknown>)[POOL_KEY] = {
    query: run,
    async connect() {
      return { query: run, release() {} };
    },
  };
  return calls;
}

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[POOL_KEY];
  resetApiLimits();
});

const vapid = webpush.generateVAPIDKeys();
const ENV = {
  KOSMOVIA_DATA_BACKEND: "api",
  DATABASE_URL: "postgresql://u:p@localhost:5432/test",
  SESSION_SECRET: SECRET,
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: "mailto:admin@example.com",
};
const NO_VAPID = { ...ENV, VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined, VAPID_SUBJECT: undefined };

function withEnv(fn: () => Promise<void>, env: Record<string, string | undefined> = ENV) {
  return async () => {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(env)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
}

const cookie = () => `${SESSION_COOKIE}=${signSessionCookie({ secret: SECRET_BYTES, wallet: ALICE, now: Date.now() }).token}`;
const post = (path: string, body: unknown) =>
  new Request(`https://kosmovia.test${path}`, {
    method: "POST",
    headers: { cookie: cookie(), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

const LOOKUP = "select endpoint, p256dh, auth from public.push_subscriptions";

/** El aviso corre sin await en la ruta: espera a que llegue a la consulta de dispositivos y devuelve a quiénes buscó. */
async function lookedUp(calls: Call[]): Promise<unknown[]> {
  for (let i = 0; i < 100; i++) {
    if (calls.some((c) => c.text.startsWith(LOOKUP))) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  await new Promise((r) => setTimeout(r, 30));
  return calls.filter((c) => c.text.startsWith(LOOKUP)).map((c) => c.values[0]);
}

const prefsRow = { payments: true, dms: true, mentions: true };

test("mensaje directo: avisa al otro participante, nunca a quien escribe", withEnv(async () => {
  const calls = installPool((text) => {
    if (text.startsWith("with ins as (insert into public.dm_messages")) return [{ id: "m1", thread_id: THREAD, author_id: aliceId, content: "hola" }];
    if (text.includes("from public.dm_threads t where t.id = $1")) return [{ id: THREAD, user_a: aliceId, user_b: BOB_ID }];
    if (text.includes("as recipient_id")) return [{ recipient_id: BOB_ID, sender_username: "alice" }];
    if (text.startsWith("select payments, dms, mentions")) return [prefsRow];
    return [];
  });
  const res = await dmPost(post(`/api/dms/${THREAD}/messages`, { content: "hola" }), idCtx(THREAD));
  assert.equal(res.status, 201);
  assert.deepEqual(await lookedUp(calls), [BOB_ID]);
}));

test("mensaje directo: con el push apagado no hace consultas de más", withEnv(async () => {
  const calls = installPool((text) => {
    if (text.startsWith("with ins as (insert into public.dm_messages")) return [{ id: "m1", thread_id: THREAD, author_id: aliceId, content: "hola" }];
    if (text.includes("from public.dm_threads t where t.id = $1")) return [{ id: THREAD, user_a: aliceId, user_b: BOB_ID }];
    return [];
  });
  const res = await dmPost(post(`/api/dms/${THREAD}/messages`, { content: "hola" }), idCtx(THREAD));
  assert.equal(res.status, 201);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!calls.some((c) => c.text.includes("as recipient_id") || c.text.includes("push_subscriptions")));
}, NO_VAPID));

test("mención en un canal: avisa a miembros que lo ven, no al autor ni a quien no es miembro", withEnv(async () => {
  const calls = installPool((text) => {
    if (text.startsWith("with ins as (insert into public.messages")) return [{ id: "m1", channel_id: CHANNEL, author_id: aliceId, content: "x" }];
    if (text.includes("from public.channels ch left join public.members m")) {
      return [{ community_id: COMMUNITY, name: "general", type: "text", visibility: "public", role: "member" }];
    }
    if (text.startsWith("select p.id, p.username, m.role")) {
      return [
        { id: aliceId, username: "alice", role: "member" },
        { id: BOB_ID, username: "bob", role: "member" },
        { id: CAROL_ID, username: "carol", role: null },
      ];
    }
    if (text.startsWith("select username from public.profiles")) return [{ username: "alice" }];
    if (text.startsWith("select payments, dms, mentions")) return [prefsRow];
    return [];
  });
  const res = await channelPost(post(`/api/channels/${CHANNEL}/messages`, { content: "hola @alice @bob @carol" }), idCtx(CHANNEL));
  assert.equal(res.status, 201);
  assert.deepEqual(await lookedUp(calls), [BOB_ID]);
}));

test("mensaje sin menciones: no consulta miembros", withEnv(async () => {
  const calls = installPool((text) => {
    if (text.startsWith("with ins as (insert into public.messages")) return [{ id: "m1", channel_id: CHANNEL, author_id: aliceId, content: "x" }];
    if (text.includes("from public.channels ch left join public.members m")) {
      return [{ community_id: COMMUNITY, name: "general", type: "text", visibility: "public", role: "member" }];
    }
    return [];
  });
  const res = await channelPost(post(`/api/channels/${CHANNEL}/messages`, { content: "hola a todos" }), idCtx(CHANNEL));
  assert.equal(res.status, 201);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!calls.some((c) => c.text.startsWith("select p.id, p.username, m.role")));
}));
