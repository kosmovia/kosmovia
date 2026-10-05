/**
 * Editar/borrar mensajes y editar el tema de un canal: reglas puras, parseo,
 * SQL, migración 0007 y rutas con un pool falso. Sin red ni base de datos.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";
import { Keypair } from "@stellar/stellar-base";

import { PATCH as channelPatch } from "../app/api/channels/[id]/route.ts";
import { DELETE as messageDelete, PATCH as messagePatch } from "../app/api/channels/[id]/messages/[messageId]/route.ts";
import { parseChannelCreate, parseChannelUpdate, parseMessageEdit } from "../lib/core/api-input.ts";
import { resetApiLimits } from "../lib/core/api-limits.ts";
import { canDeleteMessage, canEditChannel, canEditMessage, isModeratorRole, type Role } from "../lib/core/authz.ts";
import { profileIdFromWallet } from "../lib/core/ids.ts";
import * as q from "../lib/core/db/sql.ts";
import { SESSION_COOKIE, signSessionCookie } from "../lib/core/session-cookie.ts";

const HOSTILE = ["x'; drop table messages; --", "1 or 1=1", "$1; select pg_sleep(10)", "\"; delete from channels; --"];
const ROLES: Role[] = [null, "member", "moderator", "admin", "owner"];

// ---------------------------------------------------------------- pure rules

test("canEditMessage: only the author, and only while still a member; nobody else, not even the owner", () => {
  for (const role of ROLES) {
    const own = canEditMessage(role, "me", "me");
    assert.equal(own.allowed, role !== null, `${role} own`);
    if (role === null) assert.ok(!own.allowed && own.code === "not_member");
    if (role !== null) {
      const other = canEditMessage(role, "someone", "me");
      assert.ok(!other.allowed && other.status === 403 && other.code === "not_author", `${role} other`);
    }
  }
});

test("canDeleteMessage: author, or owner/admin/moderator; a plain member cannot delete others' messages", () => {
  for (const role of ROLES) {
    const own = canDeleteMessage(role, "me", "me");
    assert.equal(own.allowed, role !== null, `${role} own`);
    const other = canDeleteMessage(role, "someone", "me");
    const expected = role === "owner" || role === "admin" || role === "moderator";
    assert.equal(other.allowed, expected, `${role} other`);
    if (role === "member") assert.ok(!other.allowed && other.status === 403 && other.code === "cannot_delete_message");
    if (role === null) assert.ok(!other.allowed && other.code === "not_member");
  }
  assert.equal(isModeratorRole("moderator"), true);
  assert.equal(isModeratorRole("member"), false);
  assert.equal(isModeratorRole(null), false);
});

test("canEditChannel: owner and admin only", () => {
  for (const role of ROLES) assert.equal(canEditChannel(role).allowed, role === "owner" || role === "admin", String(role));
  const d = canEditChannel("moderator");
  assert.ok(!d.allowed && d.status === 403 && d.code === "not_admin");
  const outsider = canEditChannel(null);
  assert.ok(!outsider.allowed && outsider.code === "not_member");
});

// ---------------------------------------------------------------- parsing

test("parseMessageEdit uses the posting rules (1..2000 characters)", () => {
  assert.deepEqual(parseMessageEdit({ content: "  hola  " }), { ok: true, value: { content: "hola" } });
  for (const bad of [{ content: "" }, { content: "   " }, { content: "a".repeat(2001) }, { content: 5 }, {}, null, [], "hola"]) {
    assert.equal(parseMessageEdit(bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(parseMessageEdit({ content: "a".repeat(2000) }).ok, true);
});

test("parseChannelUpdate: trimmed topic 0..200; empty becomes null; anything else is rejected", () => {
  assert.deepEqual(parseChannelUpdate({ topic: "  Ideas  " }), { ok: true, value: { topic: "Ideas" } });
  assert.deepEqual(parseChannelUpdate({ topic: "" }), { ok: true, value: { topic: null } });
  assert.deepEqual(parseChannelUpdate({ topic: "   " }), { ok: true, value: { topic: null } });
  assert.equal(parseChannelUpdate({ topic: "a".repeat(200) }).ok, true);
  for (const bad of [{ topic: "a".repeat(201) }, { topic: 3 }, { topic: null }, {}, null, [], "x"]) {
    assert.equal(parseChannelUpdate(bad).ok, false, JSON.stringify(bad));
  }
});

test("parseChannelCreate keeps accepting an optional topic (0..200)", () => {
  assert.deepEqual(parseChannelCreate({ name: "ideas" }), { ok: true, value: { name: "ideas", topic: null, type: "text" } });
  assert.deepEqual(parseChannelCreate({ name: "ideas", topic: " Lluvia " }), { ok: true, value: { name: "ideas", topic: "Lluvia", type: "text" } });
  assert.equal(parseChannelCreate({ name: "ideas", topic: "a".repeat(201) }).ok, false);
});

// ---------------------------------------------------------------- SQL builders

function assertParameterized(query: q.Query, hostile: string[]) {
  for (const bad of hostile) {
    assert.ok(!query.text.includes(bad), `user input leaked into the SQL text: ${bad}`);
    assert.ok(query.values.includes(bad), `the value must travel in values: ${bad}`);
  }
  const used = new Set([...query.text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  assert.equal(Math.max(0, ...used), query.values.length);
  for (let i = 1; i <= query.values.length; i += 1) assert.ok(used.has(i), `$${i} is never used`);
}

test("updateMessage is parameterized, author-only and re-checks membership inside the UPDATE", () => {
  const [a, b, c, d] = HOSTILE;
  const query = q.updateMessage(a, b, c, d);
  assertParameterized(query, [a, b, c, d]);
  assert.deepEqual(query.values, [a, b, c, d]);
  assert.match(query.text, /update public\.messages m set content = \$4, edited_at = now\(\)/);
  assert.match(query.text, /m\.channel_id = \$1/);
  assert.match(query.text, /m\.author_id = \$3::uuid/);
  assert.match(query.text, /mem\.profile_id = \$3::uuid/);
  assert.match(query.text, /as edited_at/);
  assert.match(query.text, /json_build_object/);
});

test("deleteMessage is parameterized and demands author or owner/admin/moderator in the DELETE itself", () => {
  const [a, b, c] = HOSTILE;
  const query = q.deleteMessage(a, b, c);
  assertParameterized(query, [a, b, c]);
  assert.match(query.text, /^delete from public\.messages m using public\.channels ch where m\.id = \$2 and m\.channel_id = \$1/);
  assert.match(query.text, /m\.author_id = \$3::uuid or mem\.role in \('owner', 'admin', 'moderator'\)/);
  assert.match(query.text, /returning m\.id/);
});

test("updateChannelTopic is parameterized and demands owner/admin in the UPDATE itself", () => {
  const [a, b, c] = HOSTILE;
  const query = q.updateChannelTopic(a, b, c);
  assertParameterized(query, [a, b, c]);
  assert.match(query.text, /^update public\.channels ch set topic = \$3 where ch\.id = \$1/);
  assert.match(query.text, /m\.role in \('owner', 'admin'\)/);
  assert.match(query.text, /m\.profile_id = \$2::uuid/);
  assert.deepEqual(q.updateChannelTopic("c", "p", null).values, ["c", "p", null]);
});

test("messageWithRole looks the message up inside its channel; message reads and posts carry edited_at", () => {
  const [a, b, c] = HOSTILE;
  const query = q.messageWithRole(a, b, c);
  assertParameterized(query, [a, b, c]);
  assert.match(query.text, /where m\.id = \$2 and m\.channel_id = \$1/);
  assert.match(q.messagesNewest("c", 50).text, /as edited_at/);
  assert.match(q.messagesAfter("c", "m", 50).text, /as edited_at/);
  assert.match(q.insertMessage("c", "a", "hola").text, /returning id, channel_id, author_id, content, created_at, edited_at/);
  assert.match(q.insertMessage("c", "a", "hola").text, /as edited_at/);
});

// ---------------------------------------------------------------- migration

const migration = readFileSync(new URL("../db/migrations/0007_mensajes_editar.sql", import.meta.url), "utf8");
const code = migration.replace(/--.*$/gm, "");

test("0007: adds a nullable messages.edited_at, idempotently", () => {
  assert.match(code, /alter table public\.messages add column if not exists edited_at timestamptz null/i);
  for (const banned of [/auth\.jwt\(/i, /row level security/i, /create policy/i, /\bgrant\b/i, /security definer/i, /drop /i]) {
    assert.doesNotMatch(code, banned, String(banned));
  }
});

// ---------------------------------------------------------------- routes

const POOL_KEY = Symbol.for("kosmovia.pg.pool");
const SECRET = randomBytes(24).toString("hex");
const COMMUNITY = "22222222-2222-4222-8222-222222222222";
const CHANNEL = "11111111-1111-4111-8111-111111111111";
const MESSAGE = "33333333-3333-4333-8333-333333333333";
const alice = Keypair.random();
const aliceId = profileIdFromWallet(alice.publicKey());
const bobId = profileIdFromWallet(Keypair.random().publicKey());

type Call = { text: string; values: unknown[] };

function installPool(handler: (text: string, values: unknown[]) => unknown[]): Call[] {
  const calls: Call[] = [];
  (globalThis as Record<symbol, unknown>)[POOL_KEY] = {
    async query(text: string, values: unknown[]) {
      calls.push({ text, values });
      return { rows: handler(text, values) };
    },
  };
  return calls;
}

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[POOL_KEY];
  resetApiLimits();
});

const API_ENV = { KOSMOVIA_DATA_BACKEND: "api", DATABASE_URL: "postgresql://u:p@localhost:5432/test", SESSION_SECRET: SECRET };

function withApiEnv(fn: () => Promise<void>) {
  return async () => {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(API_ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
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

const cookie = `${SESSION_COOKIE}=${signSessionCookie({ secret: Buffer.from(SECRET), wallet: alice.publicKey() }).token}`;

function req(path: string, method: string, withCookie: boolean, body?: unknown): Request {
  const headers: Record<string, string> = {};
  if (withCookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://kosmovia.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const msgPath = (c = CHANNEL, m = MESSAGE) => `/api/channels/${c}/messages/${m}`;
const msgParams = (c = CHANNEL, m = MESSAGE) => params({ id: c, messageId: m });

/** Fake DB: alice has `callerRole`; the message belongs to `authorId`. */
function messageDb(callerRole: string | null, authorId: string, opts: { missing?: boolean; writeMatches?: boolean } = {}) {
  const writeMatches = opts.writeMatches ?? true;
  return (text: string) => {
    if (text.startsWith("select m.id, m.author_id, ch.community_id, mem.role")) {
      return opts.missing ? [] : [{ id: MESSAGE, author_id: authorId, community_id: COMMUNITY, role: callerRole }];
    }
    if (text.startsWith("with upd as (update public.messages")) {
      return writeMatches
        ? [{ id: MESSAGE, channel_id: CHANNEL, author_id: aliceId, content: "nuevo", created_at: "2026-01-01T00:00:00.000000Z", edited_at: "2026-01-02T00:00:00.000000Z", author: { id: aliceId, username: "alice" } }]
        : [];
    }
    if (text.startsWith("delete from public.messages")) return writeMatches ? [{ id: MESSAGE }] : [];
    return [];
  };
}

test(
  "PATCH message: the author edits and gets the message back with edited_at and author",
  withApiEnv(async () => {
    const calls = installPool(messageDb("member", aliceId));
    const res = await messagePatch(req(msgPath(), "PATCH", true, { content: "  nuevo  " }), msgParams());
    assert.equal(res.status, 200);
    const { message } = await res.json();
    assert.equal(message.content, "nuevo");
    assert.equal(message.edited_at, "2026-01-02T00:00:00.000000Z");
    assert.equal(message.author.id, aliceId);
    const update = calls.find((c) => c.text.startsWith("with upd as"));
    assert.deepEqual(update?.values, [CHANNEL, MESSAGE, aliceId, "nuevo"]);
  }),
);

test(
  "PATCH message: not the author (even owner) is 403 not_author and no UPDATE runs; 404, 400, 401 and a lost race are handled",
  withApiEnv(async () => {
    for (const role of ["member", "moderator", "admin", "owner"]) {
      const calls = installPool(messageDb(role, bobId));
      const res = await messagePatch(req(msgPath(), "PATCH", true, { content: "x" }), msgParams());
      assert.equal(res.status, 403, role);
      assert.equal((await res.json()).code, "not_author");
      assert.ok(!calls.some((c) => c.text.startsWith("with upd as")));
    }

    installPool(messageDb(null, aliceId));
    assert.equal((await messagePatch(req(msgPath(), "PATCH", true, { content: "x" }), msgParams())).status, 403);

    installPool(messageDb("member", aliceId, { missing: true }));
    assert.equal((await messagePatch(req(msgPath(), "PATCH", true, { content: "x" }), msgParams())).status, 404);
    assert.equal((await messagePatch(req(msgPath(CHANNEL, "nope"), "PATCH", true, { content: "x" }), msgParams(CHANNEL, "nope"))).status, 404);

    installPool(messageDb("member", aliceId));
    assert.equal((await messagePatch(req(msgPath(), "PATCH", true, { content: "" }), msgParams())).status, 400);
    assert.equal((await messagePatch(req(msgPath(), "PATCH", true, { content: "a".repeat(2001) }), msgParams())).status, 400);
    assert.equal((await messagePatch(req(msgPath(), "PATCH", false, { content: "x" }), msgParams())).status, 401);

    installPool(messageDb("member", aliceId, { writeMatches: false }));
    assert.equal((await messagePatch(req(msgPath(), "PATCH", true, { content: "x" }), msgParams())).status, 403);
  }),
);

test(
  "DELETE message: author and owner/admin/moderator delete; a plain member gets 403 cannot_delete_message and no DELETE runs",
  withApiEnv(async () => {
    const del = () => messageDelete(req(msgPath(), "DELETE", true), msgParams());

    const own = installPool(messageDb("member", aliceId));
    const ok = await del();
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true });
    assert.deepEqual(own.find((c) => c.text.startsWith("delete from public.messages"))?.values, [CHANNEL, MESSAGE, aliceId]);

    for (const role of ["moderator", "admin", "owner"]) {
      installPool(messageDb(role, bobId));
      assert.equal((await del()).status, 200, role);
    }

    const calls = installPool(messageDb("member", bobId));
    const denied = await del();
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, "cannot_delete_message");
    assert.ok(!calls.some((c) => c.text.startsWith("delete from")));

    installPool(messageDb(null, bobId));
    assert.equal((await del()).status, 403);

    installPool(messageDb("owner", bobId, { missing: true }));
    assert.equal((await del()).status, 404);
    assert.equal((await messageDelete(req(msgPath("nope"), "DELETE", true), msgParams("nope"))).status, 404);
    assert.equal((await messageDelete(req(msgPath(), "DELETE", false), msgParams())).status, 401);

    installPool(messageDb("owner", bobId, { writeMatches: false }));
    assert.equal((await del()).status, 403);
  }),
);

function channelDb(callerRole: string | null) {
  return (text: string, values: unknown[]) => {
    if (text.includes("left join public.members")) return [{ id: CHANNEL, community_id: COMMUNITY, name: "ideas", type: "text", role: callerRole }];
    if (text.startsWith("update public.channels")) return [{ id: CHANNEL, community_id: COMMUNITY, name: "ideas", topic: values[2], type: "text" }];
    return [];
  };
}

test(
  "PATCH channel topic: owner/admin set it (empty clears it); moderators, members and outsiders get 403; bad bodies 400; unknown channel 404",
  withApiEnv(async () => {
    const patch = (body: unknown, id = CHANNEL, withCookie = true) =>
      channelPatch(req(`/api/channels/${id}`, "PATCH", withCookie, body), params({ id }));

    for (const role of ["owner", "admin"]) {
      const calls = installPool(channelDb(role));
      const res = await patch({ topic: "  Ideas  " });
      assert.equal(res.status, 200, role);
      assert.deepEqual((await res.json()).channel, { id: CHANNEL, community_id: COMMUNITY, name: "ideas", topic: "Ideas", type: "text" });
      assert.deepEqual(calls.find((c) => c.text.startsWith("update public.channels"))?.values, [CHANNEL, aliceId, "Ideas"]);
    }

    const calls = installPool(channelDb("admin"));
    assert.equal((await (await patch({ topic: "" })).json()).channel.topic, null);
    assert.equal(calls.find((c) => c.text.startsWith("update public.channels"))?.values[2], null);

    for (const role of ["moderator", "member", null]) {
      const denied = installPool(channelDb(role));
      assert.equal((await patch({ topic: "x" })).status, 403, String(role));
      assert.ok(!denied.some((c) => c.text.startsWith("update")));
    }

    installPool(channelDb("owner"));
    assert.equal((await patch({ topic: "a".repeat(201) })).status, 400);
    assert.equal((await patch({})).status, 400);
    assert.equal((await patch({ topic: 5 })).status, 400);
    assert.equal((await patch({ topic: "x" }, "not-a-uuid")).status, 404);
    assert.equal((await patch({ topic: "x" }, CHANNEL, false)).status, 401);

    installPool(() => []);
    assert.equal((await patch({ topic: "x" })).status, 404);
  }),
);
