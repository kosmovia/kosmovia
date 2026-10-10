/**
 * Notificaciones push (migración 0014): validación de suscripciones y preferencias,
 * textos, menciones, `notify` (prefs, envío, limpieza, nunca lanza), rutas con un pool
 * falso y la migración. Sin red ni base de datos.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";
import { Keypair } from "@stellar/stellar-base";
import webpush from "web-push";

import { POST as logoutPost } from "../app/api/auth/logout/route.ts";
import { GET as prefsGet, PUT as prefsPut } from "../app/api/push/prefs/route.ts";
import { GET as publicKeyGet } from "../app/api/push/public-key/route.ts";
import { DELETE as subsDelete, POST as subsPost } from "../app/api/push/subscriptions/route.ts";
import { resetApiLimits } from "../lib/core/api-limits.ts";
import * as pushSql from "../lib/core/db/push-sql.ts";
import { SCHEMA_TABLES } from "../lib/core/db/sql.ts";
import { profileIdFromWallet } from "../lib/core/ids.ts";
import { notify, pushConfigured, readVapid, type PushDeps, type PushMessage } from "../lib/core/push.ts";
import {
  DEFAULT_PREFS,
  dmText,
  extractMentions,
  formatAmount,
  isAllowedPushEndpoint,
  mentionText,
  parseEndpointBody,
  parsePrefsPatch,
  parsePushSubscription,
  paymentText,
  pickMentionRecipients,
  shortUserAgent,
} from "../lib/core/push-rules.ts";
import { SESSION_COOKIE, signSessionCookie } from "../lib/core/session-cookie.ts";

const SECRET = randomBytes(24).toString("hex");
const SECRET_BYTES = Buffer.from(SECRET);
const ALICE = Keypair.random().publicKey();
const aliceId = profileIdFromWallet(ALICE);

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/" + "a".repeat(60);
const P256DH = "B" + "x".repeat(86);
const AUTH = "y".repeat(22);
const goodSub = { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } };

// ------------------------------------------------------------ suscripciones

test("parsePushSubscription: acepta PushSubscription.toJSON() de los servicios de push", () => {
  const ok = parsePushSubscription(goodSub);
  assert.deepEqual(ok, { ok: true, value: { endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH } });
  for (const endpoint of [
    "https://updates.push.services.mozilla.com/wpush/v2/" + "a".repeat(40),
    "https://web.push.apple.com/" + "a".repeat(40),
    "https://wns2-par02p.notify.windows.com/w/?token=" + "a".repeat(20),
  ]) {
    assert.equal(parsePushSubscription({ ...goodSub, endpoint }).ok, true, endpoint);
  }
});

test("parsePushSubscription: endpoint solo https de servicios de push (el servidor hace POST ahí)", () => {
  for (const endpoint of [
    "http://fcm.googleapis.com/fcm/send/" + "a".repeat(40), // no https
    "https://evil.example.com/fcm.googleapis.com/" + "a".repeat(30), // otro host
    "https://fcm.googleapis.com.evil.com/send/" + "a".repeat(30), // sufijo falso
    "https://localhost/" + "a".repeat(30),
    "https://169.254.169.254/latest/meta-data/",
    "https://user:pass@fcm.googleapis.com/send/" + "a".repeat(30),
    "https://fcm.googleapis.com:8443/send/" + "a".repeat(30),
    "https://fcm.googleapis.com/" + "a".repeat(1000), // demasiado larga
    "not a url at all, but long enough",
    "",
    42,
    null,
  ]) {
    assert.equal(isAllowedPushEndpoint(endpoint), false, String(endpoint).slice(0, 50));
    assert.equal(parsePushSubscription({ ...goodSub, endpoint }).ok, false);
  }
});

test("parsePushSubscription: claves p256dh y auth", () => {
  assert.equal(parsePushSubscription(null).ok, false);
  assert.equal(parsePushSubscription({ endpoint: ENDPOINT }).ok, false);
  assert.equal(parsePushSubscription({ endpoint: ENDPOINT, keys: { p256dh: P256DH } }).ok, false);
  assert.equal(parsePushSubscription({ endpoint: ENDPOINT, keys: { p256dh: "corta", auth: AUTH } }).ok, false);
  assert.equal(parsePushSubscription({ endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: "corta" } }).ok, false);
  assert.equal(parsePushSubscription({ endpoint: ENDPOINT, keys: { p256dh: P256DH + "!", auth: AUTH } }).ok, false);
  assert.equal(parsePushSubscription({ endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: "y".repeat(40) } }).ok, false);
});

test("parseEndpointBody y shortUserAgent", () => {
  assert.deepEqual(parseEndpointBody({ endpoint: ENDPOINT }), { ok: true, endpoint: ENDPOINT });
  assert.equal(parseEndpointBody({}).ok, false);
  assert.equal(parseEndpointBody({ endpoint: "x" }).ok, false);
  assert.equal(shortUserAgent("Mozilla/5.0\n\u0000(X11)"), "Mozilla/5.0  (X11)");
  assert.equal(shortUserAgent("a".repeat(500))?.length, 120);
  assert.equal(shortUserAgent(null), null);
  assert.equal(shortUserAgent("   "), null);
});

// ------------------------------------------------------------- preferencias

test("parsePrefsPatch: subconjunto de booleanos, al menos uno", () => {
  assert.deepEqual(parsePrefsPatch({ dms: false }), { ok: true, value: { dms: false } });
  assert.deepEqual(parsePrefsPatch({ payments: true, mentions: false, extra: 1 }), { ok: true, value: { payments: true, mentions: false } });
  assert.equal(parsePrefsPatch({}).ok, false);
  assert.equal(parsePrefsPatch({ dms: "no" }).ok, false);
  assert.equal(parsePrefsPatch({ dms: 0 }).ok, false);
  assert.equal(parsePrefsPatch([true]).ok, false);
  assert.equal(parsePrefsPatch(null).ok, false);
  assert.deepEqual(DEFAULT_PREFS, { payments: true, dms: true, mentions: true });
});

// ------------------------------------------------------------------- textos

test("textos: pago, directo y mención", () => {
  assert.equal(formatAmount("0.0100000"), "0.01");
  assert.equal(formatAmount("5.0000000"), "5");
  assert.equal(formatAmount("12.5000000"), "12.5");
  assert.equal(formatAmount("7"), "7");
  assert.equal(paymentText({ amount: "0.0100000", asset: "USDC", fromUsername: "ana" }).body, "Recibiste 0.01 USDC de @ana");
  assert.equal(paymentText({ amount: "3.0000000", asset: "XLM", fromUsername: null }).body, "Recibiste 3 XLM de alguien");

  const dm = dmText("ana", "Hola,\n  ¿cómo   vas?");
  assert.equal(dm.title, "@ana te escribió");
  assert.equal(dm.body, "Hola, ¿cómo vas?");
  const long = dmText("ana", "x".repeat(300));
  assert.ok(long.body.length <= 80, "vista previa de máx 80");
  assert.ok(long.body.endsWith("…"));
  assert.equal(dmText("ana", "y".repeat(80)).body, "y".repeat(80));

  assert.equal(mentionText("ana", "general").body, "@ana te mencionó en #general");
});

// ----------------------------------------------------------------- menciones

test("extractMentions: @usuario válidos, sin repetir, sin correos, máx 10", () => {
  assert.deepEqual(extractMentions("hola @Bob y @carol_1, @bob de nuevo"), ["bob", "carol_1"]);
  assert.deepEqual(extractMentions("@ana"), ["ana"]);
  assert.deepEqual(extractMentions("escríbeme a juan@correo.com"), []);
  assert.deepEqual(extractMentions("@ab muy corto"), []);
  assert.deepEqual(extractMentions("@" + "a".repeat(21)), []);
  assert.deepEqual(extractMentions("sin menciones"), []);
  const many = Array.from({ length: 15 }, (_, i) => `@user${String(i).padStart(2, "0")}`).join(" ");
  assert.equal(extractMentions(many).length, 10);
});

test("pickMentionRecipients: no avisa al autor, a no miembros ni a quien no ve el canal", () => {
  const cands = [
    { id: "author", username: "ana", role: "member" },
    { id: "bob", username: "bob", role: "member" },
    { id: "ghost", username: "ghost", role: null },
    { id: "mod", username: "mod", role: "moderator" },
    { id: "bob", username: "bob", role: "member" },
  ];
  assert.deepEqual(
    pickMentionRecipients(cands, { authorId: "author", visibility: "public" }).map((c) => c.id),
    ["bob", "mod"],
  );
  assert.deepEqual(
    pickMentionRecipients(cands, { authorId: "author", visibility: "private" }).map((c) => c.id),
    ["mod"],
  );
  const lots = Array.from({ length: 30 }, (_, i) => ({ id: `u${i}`, username: `u${i}`, role: "member" }));
  assert.equal(pickMentionRecipients(lots, { authorId: "x", visibility: "public" }).length, 10);
});

// ------------------------------------------------------------------- notify

function fakeDeps(over: Partial<PushDeps> = {}) {
  const sent: string[] = [];
  const removed: string[] = [];
  const touched: string[] = [];
  const deps: PushDeps = {
    configured: () => true,
    getPrefs: async () => ({ ...DEFAULT_PREFS }),
    subscriptionsOf: async () => [
      { endpoint: "https://fcm.googleapis.com/a", p256dh: "k1", auth: "a1" },
      { endpoint: "https://fcm.googleapis.com/b", p256dh: "k2", auth: "a2" },
    ],
    removeDeadEndpoint: async (e) => void removed.push(e),
    touchSubscription: async (e) => void touched.push(e),
    send: async (sub, payload) => void sent.push(`${sub.endpoint} ${payload}`),
    ...over,
  };
  return { deps, sent, removed, touched };
}

const MSG: PushMessage = { kind: "dms", title: "@ana te escribió", body: "hola", url: "/plataforma", tag: "dm-1" };

test("notify: manda a todos los dispositivos con título, cuerpo, url y tag", async () => {
  const { deps, sent, touched } = fakeDeps();
  assert.equal(await notify("p1", MSG, deps), 2);
  assert.equal(sent.length, 2);
  const payload = JSON.parse(sent[0].slice(sent[0].indexOf("{")));
  assert.deepEqual(payload, { title: "@ana te escribió", body: "hola", url: "/plataforma", tag: "dm-1", icon: "/icons/icon-192.png" });
  assert.equal(touched.length, 2);
});

test("notify: respeta las preferencias del tipo y el push apagado", async () => {
  const off = fakeDeps({ getPrefs: async () => ({ payments: true, dms: false, mentions: true }) });
  assert.equal(await notify("p1", MSG, off.deps), 0);
  assert.equal(off.sent.length, 0);
  assert.equal(await notify("p1", { ...MSG, kind: "payments" }, off.deps), 2);

  let asked = false;
  const unconfigured = fakeDeps({ configured: () => false, getPrefs: async () => ((asked = true), { ...DEFAULT_PREFS }) });
  assert.equal(await notify("p1", MSG, unconfigured.deps), 0);
  assert.equal(asked, false, "apagado: ni consulta la base");
});

test("notify: sin dispositivos no envía; una url externa se cambia por /plataforma", async () => {
  const none = fakeDeps({ subscriptionsOf: async () => [] });
  assert.equal(await notify("p1", MSG, none.deps), 0);
  const ext = fakeDeps();
  await notify("p1", { ...MSG, url: "https://evil.example/x" }, ext.deps);
  assert.equal(JSON.parse(ext.sent[0].slice(ext.sent[0].indexOf("{"))).url, "/plataforma");
  const proto = fakeDeps();
  await notify("p1", { ...MSG, url: "//evil.example/x" }, proto.deps);
  assert.equal(JSON.parse(proto.sent[0].slice(proto.sent[0].indexOf("{"))).url, "/plataforma");
});

test("notify: borra las suscripciones 404/410, conserva las demás y no lanza", async () => {
  const { deps, removed } = fakeDeps({
    send: async (sub) => {
      if (sub.endpoint.endsWith("/a")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      throw Object.assign(new Error("boom"), { statusCode: 500 });
    },
  });
  assert.equal(await notify("p1", MSG, deps), 0);
  assert.deepEqual(removed, ["https://fcm.googleapis.com/a"]);

  const notFound = fakeDeps({ send: async () => Promise.reject(Object.assign(new Error("x"), { statusCode: 404 })) });
  assert.equal(await notify("p1", MSG, notFound.deps), 0);
  assert.equal(notFound.removed.length, 2);
});

test("notify: no lanza aunque falle web-push, la base o el borrado", async () => {
  const log = console.error;
  console.error = () => {};
  try {
    const sendFails = fakeDeps({ send: async () => { throw new Error("web-push roto"); } });
    assert.equal(await notify("p1", MSG, sendFails.deps), 0);
    const dbFails = fakeDeps({ getPrefs: async () => { throw new Error("db caída"); } });
    assert.equal(await notify("p1", MSG, dbFails.deps), 0);
    const listFails = fakeDeps({ subscriptionsOf: async () => { throw new Error("db caída"); } });
    assert.equal(await notify("p1", MSG, listFails.deps), 0);
    const cleanFails = fakeDeps({
      send: async () => { throw Object.assign(new Error("gone"), { statusCode: 410 }); },
      removeDeadEndpoint: async () => { throw new Error("db caída"); },
    });
    assert.equal(await notify("p1", MSG, cleanFails.deps), 0);
  } finally {
    console.error = log;
  }
});

test("notify (por defecto): sin claves VAPID no hace nada ni toca la base", async () => {
  const saved = { ...process.env };
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
  try {
    assert.equal(pushConfigured(), false);
    assert.equal(await notify("p1", MSG), 0);
  } finally {
    Object.assign(process.env, saved);
  }
});

test("readVapid: pide las tres variables con forma válida", () => {
  const keys = webpush.generateVAPIDKeys();
  const env = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "mailto:admin@example.com" };
  assert.ok(readVapid(env));
  assert.ok(readVapid({ ...env, VAPID_SUBJECT: "https://kosmovia.example.com" }));
  assert.equal(readVapid({ ...env, VAPID_SUBJECT: "admin@example.com" }), null);
  assert.equal(readVapid({ ...env, VAPID_PUBLIC_KEY: "" }), null);
  assert.equal(readVapid({ ...env, VAPID_PRIVATE_KEY: undefined }), null);
  assert.equal(readVapid({ ...env, VAPID_PUBLIC_KEY: "corta" }), null);
  assert.equal(readVapid({}), null);
});

// ---------------------------------------------------------------------- SQL

test("SQL de push: parametrizado y con entrada hostil solo en values", () => {
  const evil = "x'; drop table profiles; --";
  const queries = [
    pushSql.upsertSubscription(aliceId, { endpoint: evil, p256dh: evil, auth: evil, userAgent: evil }),
    pushSql.trimSubscriptions(aliceId, 10),
    pushSql.deleteSubscription(aliceId, evil),
    pushSql.deleteDeadEndpoint(evil),
    pushSql.listSubscriptions(aliceId),
    pushSql.touchSubscription(evil),
    pushSql.getPrefs(aliceId),
    pushSql.upsertPrefs(aliceId, { dms: false }),
    pushSql.usernameOf(aliceId),
    pushSql.dmRecipient(evil, aliceId),
    pushSql.mentionCandidates(aliceId, [evil]),
  ];
  for (const query of queries) {
    assert.doesNotMatch(query.text, /drop table/i);
    assert.match(query.text, /\$1/);
  }
  assert.deepEqual(pushSql.upsertPrefs(aliceId, { dms: false }).values, [aliceId, null, false, null]);
  assert.match(pushSql.upsertSubscription(aliceId, { endpoint: "e", p256dh: "p", auth: "a", userAgent: null }).text, /on conflict \(endpoint\) do update/);
  assert.ok((SCHEMA_TABLES as readonly string[]).includes("push_subscriptions"));
  assert.ok((SCHEMA_TABLES as readonly string[]).includes("notification_prefs"));
});

// ---------------------------------------------------------------- migración

const migration = readFileSync(new URL("../db/migrations/0014_push.sql", import.meta.url), "utf8");

test("migración 0014: tablas, endpoint único, cascada e idempotencia", () => {
  assert.match(migration, /create table if not exists public\.push_subscriptions/);
  assert.match(migration, /profile_id\s+uuid not null references public\.profiles \(id\) on delete cascade/);
  assert.match(migration, /unique \(endpoint\)/);
  assert.match(migration, /create table if not exists public\.notification_prefs/);
  assert.match(migration, /profile_id uuid primary key references public\.profiles \(id\) on delete cascade/);
  assert.match(migration, /payments\s+boolean not null default true/);
  assert.match(migration, /dms\s+boolean not null default true/);
  assert.match(migration, /mentions\s+boolean not null default true/);
  assert.match(migration, /last_used_at/);
  assert.doesNotMatch(migration, /^create table (?!if not exists)/im);
  assert.doesNotMatch(migration, /^create index (?!if not exists)/im);
  const adds = migration.match(/add constraint (\w+)/g) ?? [];
  const drops = migration.match(/drop constraint if exists (\w+)/g) ?? [];
  assert.equal(adds.length, drops.length);
  assert.doesNotMatch(migration, /\bdrop table\b/i);
});

// ------------------------------------------------------ rutas (pool falso)

const POOL_KEY = Symbol.for("kosmovia.pg.pool");
type Call = { text: string; values: unknown[] };

function installPool(handler: (text: string, values: unknown[]) => unknown[] = () => []): Call[] {
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

function req(path: string, method: string, body?: unknown, withCookie = true): Request {
  const headers: Record<string, string> = { "user-agent": "Mozilla/5.0 (pruebas)" };
  if (withCookie) headers.cookie = cookie();
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://kosmovia.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

test("GET /api/push/public-key: público; sin claves dice configured:false", withEnv(async () => {
  const on = await (await publicKeyGet()).json();
  assert.deepEqual(on, { configured: true, publicKey: vapid.publicKey });
}));

test("GET /api/push/public-key: sin VAPID está apagado", withEnv(async () => {
  assert.deepEqual(await (await publicKeyGet()).json(), { configured: false, publicKey: null });
}, { ...ENV, VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined, VAPID_SUBJECT: undefined }));

test("POST /api/push/subscriptions: guarda con el perfil de la sesión (nunca el del cuerpo)", withEnv(async () => {
  const calls = installPool((text) => (text.startsWith("insert into public.push_subscriptions") ? [{ id: "x" }] : []));
  const res = await subsPost(req("/api/push/subscriptions", "POST", { ...goodSub, profileId: "otro" }));
  assert.equal(res.status, 201);
  const insert = calls.find((c) => c.text.startsWith("insert into public.push_subscriptions"));
  assert.deepEqual(insert?.values, [aliceId, ENDPOINT, P256DH, AUTH, "Mozilla/5.0 (pruebas)"]);
  assert.ok(calls.some((c) => c.text.startsWith("delete from public.push_subscriptions") && c.values[0] === aliceId), "recorta a 10");
}));

test("POST /api/push/subscriptions: 401 sin sesión, 400 con endpoint ajeno, 503 sin claves", withEnv(async () => {
  const calls = installPool();
  assert.equal((await subsPost(req("/api/push/subscriptions", "POST", goodSub, false))).status, 401);
  const bad = await subsPost(req("/api/push/subscriptions", "POST", { ...goodSub, endpoint: "https://evil.example.com/" + "a".repeat(30) }));
  assert.equal(bad.status, 400);
  assert.equal(calls.length, 0, "no toca la base");
}));

test("POST /api/push/subscriptions: sin claves VAPID responde 503 push_not_configured", withEnv(async () => {
  installPool();
  const res = await subsPost(req("/api/push/subscriptions", "POST", goodSub));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "push_not_configured");
}, { ...ENV, VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined, VAPID_SUBJECT: undefined }));

test("DELETE /api/push/subscriptions: borra solo la fila del perfil de la sesión", withEnv(async () => {
  const calls = installPool();
  const res = await subsDelete(req("/api/push/subscriptions", "DELETE", { endpoint: ENDPOINT }));
  assert.equal(res.status, 200);
  assert.deepEqual(calls[0].values, [aliceId, ENDPOINT]);
  assert.match(calls[0].text, /profile_id = \$1 and endpoint = \$2/);
  assert.equal((await subsDelete(req("/api/push/subscriptions", "DELETE", {}))).status, 400);
}));

test("GET/PUT /api/push/prefs: por defecto todo activado; PUT mezcla y valida", withEnv(async () => {
  installPool();
  const got = await prefsGet(req("/api/push/prefs", "GET"));
  assert.deepEqual((await got.json()).prefs, DEFAULT_PREFS);

  const calls = installPool((text) => (text.startsWith("insert into public.notification_prefs") ? [{ payments: true, dms: false, mentions: true }] : []));
  const put = await prefsPut(req("/api/push/prefs", "PUT", { dms: false }));
  assert.equal(put.status, 200);
  assert.deepEqual((await put.json()).prefs, { payments: true, dms: false, mentions: true });
  assert.deepEqual(calls[0].values, [aliceId, null, false, null]);

  assert.equal((await prefsPut(req("/api/push/prefs", "PUT", { dms: "no" }))).status, 400);
  assert.equal((await prefsPut(req("/api/push/prefs", "PUT", {}))).status, 400);
  assert.equal((await prefsGet(req("/api/push/prefs", "GET", undefined, false))).status, 401);
}));

test("push subscription sync refuses a changed account before touching DB", withEnv(async () => {
  const calls = installPool();
  const res = await subsPost(req("/api/push/subscriptions", "POST", { ...goodSub, expectedProfileId: "other-profile" }));
  assert.equal(res.status, 409);
  assert.equal(calls.length, 0);
}));

test("logout detaches only the authenticated profile and requested device", withEnv(async () => {
  const calls = installPool();
  const res = await logoutPost(req("/api/auth/logout", "POST", { endpoint: ENDPOINT, profileId: "other-profile" }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).pushDetached, true);
  assert.ok(res.headers.get("set-cookie")?.includes("Max-Age=0"));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, [aliceId, ENDPOINT]);
  assert.match(calls[0].text, /profile_id = \$1 and endpoint = \$2/);
}));

test("anonymous logout never detaches another profile's push device", withEnv(async () => {
  const calls = installPool();
  const res = await logoutPost(req("/api/auth/logout", "POST", { endpoint: ENDPOINT }, false));
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
}));
