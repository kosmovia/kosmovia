/**
 * Categorías de canales, canales privados / de pagos y mensajes directos
 * (migración 0008): reglas puras, parseo, SQL, la migración y rutas con un pool
 * falso. Sin red ni base de datos.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";
import { Keypair } from "@stellar/stellar-base";

import { DELETE as categoryDelete, PATCH as categoryPatch } from "../app/api/categories/[id]/route.ts";
import { POST as categoryPost } from "../app/api/communities/[slug]/categories/route.ts";
import { GET as channelsGet, POST as channelsPost } from "../app/api/communities/[slug]/channels/route.ts";
import { GET as dmsGet, POST as dmsPost } from "../app/api/dms/route.ts";
import { GET as dmMessagesGet, POST as dmMessagesPost } from "../app/api/dms/[id]/messages/route.ts";
import { DELETE as dmMessageDelete, PATCH as dmMessagePatch } from "../app/api/dms/[id]/messages/[messageId]/route.ts";
import { PATCH as channelPatch } from "../app/api/channels/[id]/route.ts";
import {
  parseCategoryCreate,
  parseCategoryUpdate,
  parseChannelCreate,
  parseChannelUpdate,
  parseDmOpen,
} from "../lib/core/api-input.ts";
import { resetApiLimits } from "../lib/core/api-limits.ts";
import {
  canAccessDm,
  canChangeDmMessage,
  canDeleteChannel,
  canManageCategories,
  canOpenDm,
  canPostInChannel,
  canUpdateChannel,
  canViewChannel,
  isChannelType,
  type Role,
} from "../lib/core/authz.ts";
import { profileIdFromWallet } from "../lib/core/ids.ts";
import * as q from "../lib/core/db/sql.ts";
import { SESSION_COOKIE, signSessionCookie } from "../lib/core/session-cookie.ts";

const HOSTILE = ["x'; drop table messages; --", "1 or 1=1", "$1; select pg_sleep(10)", "\"; delete from channels; --"];
const ROLES: Role[] = [null, "member", "moderator", "admin", "owner"];
const STAFF: Role[] = ["moderator", "admin", "owner"];

// ---------------------------------------------------------------- pure rules

test("canViewChannel: public = any member; private = owner/admin/moderator only", () => {
  for (const role of ROLES) {
    assert.equal(canViewChannel(role, "public").allowed, role !== null, `${role}/public`);
    assert.equal(canViewChannel(role, "private").allowed, STAFF.includes(role), `${role}/private`);
  }
  const member = canViewChannel("member", "private");
  assert.ok(!member.allowed && member.status === 403 && member.code === "private_channel");
  const outsider = canViewChannel(null, "private");
  assert.ok(!outsider.allowed && outsider.code === "not_member");
});

test("canPostInChannel: text and payments = any member; announcement = owner/admin; private = staff only", () => {
  for (const role of ROLES) {
    assert.equal(canPostInChannel(role, "text").allowed, role !== null, `${role}/text`);
    assert.equal(canPostInChannel(role, "payments").allowed, role !== null, `${role}/payments`);
    assert.equal(canPostInChannel(role, "announcement").allowed, role === "owner" || role === "admin", `${role}/announcement`);
    assert.equal(canPostInChannel(role, "text", "private").allowed, STAFF.includes(role), `${role}/text/private`);
  }
  // Un moderador no escribe en anuncios aunque pueda ver canales privados.
  assert.equal(canPostInChannel("moderator", "announcement", "private").allowed, false);
  const denied = canPostInChannel("member", "text", "private");
  assert.ok(!denied.allowed && denied.code === "private_channel");
});

test("canDeleteChannel: #general and the payments channel are protected; #cobros is not", () => {
  const general = canDeleteChannel("owner", "general", "text");
  assert.ok(!general.allowed && general.status === 400 && general.code === "general_protected");
  const payments = canDeleteChannel("owner", "verificacion-pagos", "payments");
  assert.ok(!payments.allowed && payments.status === 400 && payments.code === "payments_protected");
  assert.equal(canDeleteChannel("owner", "cobros", "text").allowed, true);
  assert.equal(canDeleteChannel("admin", "cobros", "text").allowed, true);
  assert.equal(canDeleteChannel("moderator", "cobros", "text").allowed, false);
  assert.equal(canDeleteChannel("member", "ideas", "text").allowed, false);
});

test("canUpdateChannel: owner/admin only; #general and payments never become private", () => {
  for (const role of ROLES) {
    assert.equal(canUpdateChannel(role, "ideas", "text", { topic: "x", visibility: "private" }).allowed, role === "owner" || role === "admin", String(role));
  }
  for (const [name, type] of [["general", "text"], ["verificacion-pagos", "payments"]] as const) {
    const d = canUpdateChannel("owner", name, type, { visibility: "private" });
    assert.ok(!d.allowed && d.status === 400 && d.code === "channel_protected", name);
    assert.equal(canUpdateChannel("owner", name, type, { visibility: "public", emoji: "💬" }).allowed, true, name);
  }
});

test("canManageCategories: owner and admin only", () => {
  for (const role of ROLES) assert.equal(canManageCategories(role).allowed, role === "owner" || role === "admin", String(role));
  const d = canManageCategories("moderator");
  assert.ok(!d.allowed && d.status === 403 && d.code === "not_admin");
  const outsider = canManageCategories(null);
  assert.ok(!outsider.allowed && outsider.code === "not_member");
});

test("payments is never a type a person can ask for when creating a channel", () => {
  assert.equal(isChannelType("text"), true);
  assert.equal(isChannelType("announcement"), true);
  assert.equal(isChannelType("payments"), false);
  assert.equal(parseChannelCreate({ name: "x", type: "payments" }).ok, false);
});

test("canOpenDm: not yourself, and only with a shared community", () => {
  const self = canOpenDm("a", "a", true);
  assert.ok(!self.allowed && self.status === 400 && self.code === "self_dm");
  const none = canOpenDm("a", "b", false);
  assert.ok(!none.allowed && none.status === 403 && none.code === "no_shared_community");
  assert.equal(canOpenDm("a", "b", true).allowed, true);
});

test("canAccessDm / canChangeDmMessage: only the two participants; only the author changes a message", () => {
  assert.equal(canAccessDm("a", "b", "a").allowed, true);
  assert.equal(canAccessDm("a", "b", "b").allowed, true);
  const out = canAccessDm("a", "b", "c");
  assert.ok(!out.allowed && out.status === 403 && out.code === "not_participant");
  assert.equal(canChangeDmMessage("a", "b", "a", "a").allowed, true);
  const other = canChangeDmMessage("a", "b", "a", "b");
  assert.ok(!other.allowed && other.code === "not_author");
  const stranger = canChangeDmMessage("a", "b", "a", "c");
  assert.ok(!stranger.allowed && stranger.code === "not_participant");
});

// ---------------------------------------------------------------- parsing

const CAT = "44444444-4444-4444-8444-444444444444";

test("parseChannelUpdate: any subset of topic, emoji, category_id, visibility, position", () => {
  assert.deepEqual(parseChannelUpdate({ topic: "  Ideas  " }), { ok: true, value: { topic: "Ideas" } });
  assert.deepEqual(parseChannelUpdate({ emoji: " 🚀 " }), { ok: true, value: { emoji: "🚀" } });
  assert.deepEqual(parseChannelUpdate({ emoji: "" }), { ok: true, value: { emoji: null } });
  assert.deepEqual(parseChannelUpdate({ emoji: null }), { ok: true, value: { emoji: null } });
  assert.deepEqual(parseChannelUpdate({ category_id: CAT }), { ok: true, value: { categoryId: CAT } });
  assert.deepEqual(parseChannelUpdate({ category_id: null }), { ok: true, value: { categoryId: null } });
  assert.deepEqual(parseChannelUpdate({ visibility: "private", position: 3 }), { ok: true, value: { visibility: "private", position: 3 } });
  for (const bad of [
    {},
    null,
    [],
    "x",
    { topic: null },
    { topic: "a".repeat(201) },
    { emoji: "a".repeat(17) },
    { emoji: 3 },
    { category_id: "no-es-uuid" },
    { category_id: 3 },
    { visibility: "secret" },
    { position: -1 },
    { position: 1.5 },
    { position: "2" },
    { position: 1001 },
    { unknown: true },
  ]) {
    assert.equal(parseChannelUpdate(bad).ok, false, JSON.stringify(bad));
  }
});

test("parseChannelCreate: optional emoji, category_id and visibility", () => {
  assert.deepEqual(parseChannelCreate({ name: "ideas", emoji: "💡", category_id: CAT, visibility: "private" }), {
    ok: true,
    value: { name: "ideas", topic: null, type: "text", emoji: "💡", categoryId: CAT, visibility: "private" },
  });
  for (const bad of [{ name: "x", visibility: "secret" }, { name: "x", category_id: "nope" }, { name: "x", emoji: "a".repeat(17) }]) {
    assert.equal(parseChannelCreate(bad).ok, false, JSON.stringify(bad));
  }
});

test("category parsers: name 1..40 trimmed; position 0..1000; at least one field on update", () => {
  assert.deepEqual(parseCategoryCreate({ name: "  Info  " }), { ok: true, value: { name: "Info" } });
  assert.equal(parseCategoryCreate({ name: "a".repeat(40) }).ok, true);
  for (const bad of [{}, null, { name: "" }, { name: "   " }, { name: "a".repeat(41) }, { name: 3 }]) {
    assert.equal(parseCategoryCreate(bad).ok, false, JSON.stringify(bad));
  }
  assert.deepEqual(parseCategoryUpdate({ name: "Nuevo", position: 2 }), { ok: true, value: { name: "Nuevo", position: 2 } });
  assert.deepEqual(parseCategoryUpdate({ position: 0 }), { ok: true, value: { position: 0 } });
  for (const bad of [{}, null, { name: "" }, { position: -1 }, { position: "1" }]) {
    assert.equal(parseCategoryUpdate(bad).ok, false, JSON.stringify(bad));
  }
});

test("parseDmOpen: a @username (with or without @) or a profileId", () => {
  assert.deepEqual(parseDmOpen({ username: "@Victor" }), { ok: true, value: { username: "victor" } });
  assert.deepEqual(parseDmOpen({ profileId: CAT }), { ok: true, value: { profileId: CAT } });
  for (const bad of [{}, null, { username: "x" }, { username: 5 }, { profileId: "no" }]) {
    assert.equal(parseDmOpen(bad).ok, false, JSON.stringify(bad));
  }
});

// ---------------------------------------------------------------- SQL builders

function assertParameterized(query: q.Query, hostile: string[]) {
  for (const bad of hostile) {
    assert.ok(!query.text.includes(bad), `user input leaked into the SQL text: ${bad}`);
    assert.ok(query.values.includes(bad), `the value must travel in values: ${bad}`);
  }
  const used = new Set([...query.text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  assert.equal(Math.max(0, ...used), query.values.length, "placeholder count must equal values count");
  for (let i = 1; i <= query.values.length; i += 1) assert.ok(used.has(i), `$${i} is never used`);
  assert.doesNotMatch(query.text, /\$\{|undefined|\[object/);
}

test("new builders keep hostile input out of the SQL text", () => {
  const [a, b, c, d] = HOSTILE;
  assertParameterized(q.listChannels(a, b), [a, b]);
  assertParameterized(q.listCategories(a, b), [a, b]);
  assertParameterized(q.categoryWithRole(a, b), [a, b]);
  assertParameterized(q.categoryInCommunity(a, b), [a, b]);
  assertParameterized(q.insertCategory(a, b, c), [a, b, c]);
  assertParameterized(q.deleteCategory(a, b), [a, b]);
  assertParameterized(q.updateCategory(a, b, { name: c, position: 2 })!, [a, b, c]);
  assertParameterized(q.updateChannel(a, b, { topic: c, emoji: d, categoryId: CAT, visibility: "private", position: 1 })!, [a, b, c, d]);
  assertParameterized(q.insertChannel({ communityId: a, name: b, topic: c, type: "text", emoji: d }), [a, b, c, d]);
  assertParameterized(q.sharedCommunity(a, b), [a, b]);
  assertParameterized(q.insertDmThread(a, b), [a, b]);
  assertParameterized(q.dmThreadOfPair(a, b), [a, b]);
  assertParameterized(q.listDmThreads(a), [a]);
  assertParameterized(q.dmThreadForUser(a, b), [a, b]);
  assertParameterized(q.dmThreadById(a), [a]);
  assertParameterized(q.dmMessagesNewest(a, b, 50, c), [a, b, c]);
  assertParameterized(q.dmMessagesAfter(a, b, c, 50), [a, b, c]);
  assertParameterized(q.markDmRead(a, b), [a, b]);
  assertParameterized(q.insertDmMessage(a, b, c), [a, b, c]);
  assertParameterized(q.dmMessageAccess(a, b), [a, b]);
  assertParameterized(q.updateDmMessage(a, b, c, d), [a, b, c, d]);
  assertParameterized(q.deleteDmMessage(a, b, c), [a, b, c]);
});

test("updateChannel / updateCategory: nothing to change = no query; only fixed columns", () => {
  assert.equal(q.updateChannel("c", "p", {}), null);
  assert.equal(q.updateCategory("k", "p", {}), null);
  const upd = q.updateChannel("c", "p", { topic: null, emoji: null, categoryId: null, visibility: "public", position: 0 })!;
  assert.match(upd.text, /set topic = \$3, emoji = \$4, category_id = \$5::uuid, visibility = \$6, position = \$7::integer where ch\.id = \$1/);
  assert.match(upd.text, /m\.role in \('owner', 'admin'\)/);
  assert.match(upd.text, /\$5::uuid is null or exists \(select 1 from public\.channel_categories k where k\.id = \$5::uuid and k\.community_id = ch\.community_id\)/);
  assert.match(upd.text, /not \(\$6 = 'private' and \(ch\.name = 'general' or ch\.type = 'payments'\)\)/);
  assert.match(upd.text, /returning ch\.id, ch\.community_id, ch\.name, ch\.topic, ch\.type, ch\.category_id, ch\.position, ch\.visibility, ch\.emoji/);
});

test("channels listing hides private channels from non-staff inside the SELECT; deletes protect payments", () => {
  const list = q.listChannels("c", "p");
  assert.match(list.text, /join public\.members vm on vm\.community_id = ch\.community_id and vm\.profile_id = \$2::uuid/);
  assert.match(list.text, /\(ch\.visibility = 'public' or vm\.role in \('owner', 'admin', 'moderator'\)\)/);
  assert.match(list.text, /order by ch\.position asc, ch\.created_at asc, ch\.id asc/);
  assert.match(q.deleteChannel("c", "p").text, /ch\.name <> 'general' and ch\.type <> 'payments'/);
  const ins = q.insertChannel({ communityId: "c", name: "n", topic: null, type: "text" });
  assert.match(ins.text, /\$4::text in \('text', 'announcement'\)/);
  assert.match(ins.text, /k\.id = \$6::uuid and k\.community_id = \$1::uuid/);
});

test("private channels: message list, post, edit and delete re-check visibility in SQL", () => {
  const staff = /\(\w+\.visibility = 'public' or \w+\.role in \('owner', 'admin', 'moderator'\)\)/;
  assert.match(q.messagesNewest("c", "v", 50).text, /vch\.visibility = 'public' or vm\.role in \('owner', 'admin', 'moderator'\)/);
  assert.match(q.messagesAfter("c", "v", "m", 50).text, /vch\.visibility = 'public' or vm\.role in \('owner', 'admin', 'moderator'\)/);
  assert.equal(q.messagesNewest("c", "v", 50, "m").values.at(-1), "v");
  assert.match(q.insertMessage("c", "a", "hi").text, staff);
  assert.match(q.updateMessage("c", "m", "a", "x").text, staff);
  assert.match(q.deleteMessage("c", "m", "a").text, staff);
  assert.match(q.insertMessage("c", "a", "hi").text, /ch\.type <> 'announcement'/);
});

test("category writes are owner/admin inside the statement itself", () => {
  for (const query of [q.insertCategory("c", "p", "n"), q.updateCategory("k", "p", { name: "n" })!, q.deleteCategory("k", "p")]) {
    assert.match(query.text, /m\.role in \('owner', 'admin'\)/);
  }
  assert.match(q.insertCategory("c", "p", "n").text, /coalesce\(\(select max\(o\.position\) \+ 1 from public\.channel_categories o/);
});

test("DMs: pair ordered, shared community re-checked in the INSERT, participants only everywhere", () => {
  const open = q.insertDmThread("a", "b");
  assert.match(open.text, /least\(\$1::uuid, \$2::uuid\), greatest\(\$1::uuid, \$2::uuid\)/);
  assert.match(open.text, /\$1::uuid <> \$2::uuid/);
  assert.match(open.text, /join public\.members y on y\.community_id = x\.community_id/);
  assert.match(open.text, /on conflict \(user_a, user_b\) do nothing/);
  const participant = /user_a = \$\d::uuid or \w+\.user_b = \$\d::uuid/;
  assert.match(q.dmMessagesNewest("t", "v", 50).text, participant);
  assert.match(q.dmMessagesAfter("t", "v", "m", 50).text, participant);
  assert.match(q.insertDmMessage("t", "a", "hi").text, /t\.user_a = \$2::uuid or t\.user_b = \$2::uuid/);
  assert.match(q.markDmRead("t", "a").text, /t\.user_a = \$2::uuid or t\.user_b = \$2::uuid/);
  for (const query of [q.updateDmMessage("t", "m", "a", "x"), q.deleteDmMessage("t", "m", "a")]) {
    assert.match(query.text, /m\.author_id = \$3::uuid/);
    assert.match(query.text, /t\.user_a = \$3::uuid or t\.user_b = \$3::uuid/);
  }
  assert.match(q.insertDmMessage("t", "a", "hi").text, /last_message_at = now\(\)/);
  const list = q.listDmThreads("a");
  assert.match(list.text, /order by t\.last_message_at desc/);
  assert.match(list.text, /as unread/);
  assert.match(list.text, /'wallet', o\.wallet/);
  // Un mensaje de DM lleva edited_at y el autor delgado, como los de canal.
  const { text } = q.dmMessagesNewest("t", "v", 10);
  assert.match(text, /as edited_at/);
  const author = /json_build_object\(([^)]*)\) as author/.exec(text)?.[1] ?? "";
  assert.doesNotMatch(author, /wallet|bio|trust_level|x_handle/);
});

// ---------------------------------------------------------------- migration 0008

const migration = readFileSync(new URL("../db/migrations/0008_categorias_privados_dm.sql", import.meta.url), "utf8");

test("0008 is idempotent: every create has IF NOT EXISTS / OR REPLACE, every constraint is dropped first", () => {
  for (const m of migration.matchAll(/create table (?!if not exists)/gi)) assert.fail(`create table without if not exists at ${m.index}`);
  for (const m of migration.matchAll(/create index (?!if not exists)/gi)) assert.fail(`create index without if not exists at ${m.index}`);
  for (const m of migration.matchAll(/create function/gi)) assert.fail(`create function without or replace at ${m.index}`);
  for (const m of migration.matchAll(/add column (?!if not exists)/gi)) assert.fail(`add column without if not exists at ${m.index}`);
  for (const m of migration.matchAll(/alter table public\.\w+ add constraint (\w+)/gi)) {
    assert.match(migration, new RegExp(`drop constraint if exists ${m[1]}`), m[1]);
  }
  assert.doesNotMatch(migration, /drop table|truncate|delete from/i);
});

test("0008 adds the categories table and the new channel columns and checks", () => {
  assert.match(migration, /create table if not exists public\.channel_categories/);
  assert.match(migration, /community_id uuid not null references public\.communities \(id\) on delete cascade/);
  assert.match(migration, /char_length\(name\) between 1 and 40/);
  assert.match(migration, /add column if not exists category_id uuid null references public\.channel_categories \(id\) on delete set null/);
  assert.match(migration, /add column if not exists position integer not null default 0/);
  assert.match(migration, /add column if not exists visibility text not null default 'public'/);
  assert.match(migration, /add column if not exists emoji text null/);
  assert.match(migration, /check \(visibility in \('public', 'private'\)\)/);
  assert.match(migration, /char_length\(emoji\) <= 16/);
  assert.match(migration, /check \(type in \('text', 'announcement', 'payments'\)\)/);
});

test("0008 backfills existing communities and the new-community trigger creates the same layout", () => {
  for (const name of ["Información", "Comunidad"]) assert.ok(migration.includes(`'${name}'`), name);
  const trigger = migration.slice(migration.indexOf("create or replace function public.on_community_created"));
  assert.match(trigger, /'anuncios'.*'announcement'.*v_info, 0, '📢'/);
  assert.match(trigger, /'cobros'.*'text'.*v_info, 1, '🧾'/);
  assert.match(trigger, /'verificacion-pagos'.*'payments'.*v_info, 2, '💸'/);
  assert.match(trigger, /'general'.*'text'.*v_com, 0, '💬'/);
  assert.match(trigger, /insert into public\.members/);
  assert.match(trigger, /Comprobantes de pagos verificados en Stellar/);
  assert.match(trigger, /Cobros en USDC: crea un cobro con \[\+\] y págalo aquí/);
  const backfill = migration.slice(0, migration.indexOf("create or replace function public.on_community_created"));
  assert.match(backfill, /not exists \(select 1 from public\.channels x where x\.community_id = c\.id and x\.name = 'cobros'\)/);
  assert.match(backfill, /not exists \(select 1 from public\.channels x where x\.community_id = c\.id and x\.name = 'verificacion-pagos'\)/);
  assert.match(backfill, /coalesce\(emoji, '📢'\)/);
  assert.match(backfill, /coalesce\(emoji, '💬'\)/);
});

test("0008 DM tables: ordered unique pair, no self chat, message length, read marks", () => {
  assert.match(migration, /create table if not exists public\.dm_threads/);
  assert.match(migration, /check \(user_a < user_b\)/);
  assert.match(migration, /unique \(user_a, user_b\)/);
  assert.match(migration, /user_a\s+uuid not null references public\.profiles \(id\)/);
  assert.match(migration, /a_read_at/);
  assert.match(migration, /b_read_at/);
  assert.match(migration, /create table if not exists public\.dm_messages/);
  assert.match(migration, /thread_id\s+uuid not null references public\.dm_threads \(id\) on delete cascade/);
  assert.match(migration, /char_length\(content\) between 1 and 2000/);
  assert.match(migration, /edited_at\s+timestamptz null/);
  assert.match(migration, /enforce_dm_message_quota/);
});

// ---------------------------------------------------------------- routes

const POOL_KEY = Symbol.for("kosmovia.pg.pool");
const SECRET = randomBytes(24).toString("hex");
const COMMUNITY = "22222222-2222-4222-8222-222222222222";
const CHANNEL = "11111111-1111-4111-8111-111111111111";
const THREAD = "55555555-5555-4555-8555-555555555555";
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

function req(path: string, method: string, body?: unknown): Request {
  const headers: Record<string, string> = { cookie };
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://kosmovia.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const COMMUNITY_ROW = { id: COMMUNITY, slug: "kosmovia", name: "Kosmovia", icon: "", description: "", owner_id: aliceId };

test(
  "GET channels: returns channels with the new fields plus categories sorted by position",
  withApiEnv(async () => {
    const channelRow = { id: CHANNEL, community_id: COMMUNITY, name: "general", topic: null, type: "text", category_id: CAT, position: 0, visibility: "public", emoji: "💬" };
    const calls = installPool((text) => {
      if (text.includes("from public.communities c where c.slug")) return [COMMUNITY_ROW];
      if (text.startsWith("select role from public.members")) return [{ role: "member" }];
      if (text.includes("from public.channels ch join public.members vm")) return [channelRow];
      if (text.includes("from public.channel_categories k join public.members vm")) {
        return [{ id: CAT, community_id: COMMUNITY, name: "Comunidad", position: 1 }];
      }
      return [];
    });
    const res = await channelsGet(req("/api/communities/kosmovia/channels", "GET"), params({ slug: "kosmovia" }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.channels, [channelRow]);
    assert.deepEqual(body.categories, [{ id: CAT, name: "Comunidad", position: 1 }]);
    const listing = calls.find((c) => c.text.includes("from public.channels ch join public.members vm"));
    assert.deepEqual(listing?.values, [COMMUNITY, aliceId]);
  }),
);

test(
  "POST channels: a category of another community is 400 invalid_category and no INSERT runs",
  withApiEnv(async () => {
    const calls = installPool((text) => {
      if (text.includes("from public.communities c where c.slug")) return [COMMUNITY_ROW];
      if (text.startsWith("select role from public.members")) return [{ role: "admin" }];
      return [];
    });
    const res = await channelsPost(req("/api/communities/kosmovia/channels", "POST", { name: "ideas", category_id: CAT }), params({ slug: "kosmovia" }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "invalid_category");
    assert.ok(!calls.some((c) => c.text.startsWith("insert into public.channels")));
  }),
);

test(
  "PATCH channel: owner/admin edit any subset; a member is 403; #general private is 400 channel_protected",
  withApiEnv(async () => {
    const row = { id: CHANNEL, community_id: COMMUNITY, name: "ideas", topic: null, type: "text", category_id: null, position: 2, visibility: "private", emoji: "💡" };
    const make = (role: string | null, name = "ideas", type = "text") =>
      installPool((text) => {
        if (text.startsWith("select ch.id, ch.community_id, ch.name, ch.type, m.role")) {
          return [{ id: CHANNEL, community_id: COMMUNITY, name, type, role, visibility: "public" }];
        }
        if (text.startsWith("update public.channels ch set")) return [row];
        return [];
      });

    const calls = make("admin");
    const res = await channelPatch(req(`/api/channels/${CHANNEL}`, "PATCH", { emoji: "💡", visibility: "private", position: 2 }), params({ id: CHANNEL }));
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).channel, row);
    assert.deepEqual(calls.find((c) => c.text.startsWith("update public.channels"))?.values, [CHANNEL, aliceId, "💡", "private", 2]);

    const member = make("member");
    const denied = await channelPatch(req(`/api/channels/${CHANNEL}`, "PATCH", { emoji: "💡" }), params({ id: CHANNEL }));
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, "not_admin");
    assert.ok(!member.some((c) => c.text.startsWith("update public.channels")));

    const general = make("owner", "general");
    const protectedRes = await channelPatch(req(`/api/channels/${CHANNEL}`, "PATCH", { visibility: "private" }), params({ id: CHANNEL }));
    assert.equal(protectedRes.status, 400);
    assert.equal((await protectedRes.json()).code, "channel_protected");
    assert.ok(!general.some((c) => c.text.startsWith("update public.channels")));
  }),
);

test(
  "categories: owner/admin create (201), rename and delete; members get 403; unknown is 404",
  withApiEnv(async () => {
    const created = { id: CAT, community_id: COMMUNITY, name: "Info", position: 2 };
    const db = (role: string | null, missing = false) =>
      installPool((text) => {
        if (text.includes("from public.communities c where c.slug")) return [COMMUNITY_ROW];
        if (text.startsWith("select role from public.members")) return [{ role }];
        if (text.startsWith("select k.id, k.community_id, m.role")) return missing ? [] : [{ id: CAT, community_id: COMMUNITY, role }];
        if (text.startsWith("insert into public.channel_categories")) return [created];
        if (text.startsWith("update public.channel_categories")) return [{ ...created, name: "Nuevo" }];
        if (text.startsWith("delete from public.channel_categories")) return [{ id: CAT }];
        return [];
      });

    db("admin");
    const post = await categoryPost(req("/api/communities/kosmovia/categories", "POST", { name: " Info " }), params({ slug: "kosmovia" }));
    assert.equal(post.status, 201);
    assert.deepEqual(await post.json(), { category: { id: CAT, name: "Info", position: 2 } });

    const patch = await categoryPatch(req(`/api/categories/${CAT}`, "PATCH", { name: "Nuevo" }), params({ id: CAT }));
    assert.equal(patch.status, 200);
    assert.deepEqual(await patch.json(), { category: { id: CAT, name: "Nuevo", position: 2 } });

    const del = await categoryDelete(req(`/api/categories/${CAT}`, "DELETE"), params({ id: CAT }));
    assert.equal(del.status, 200);
    assert.deepEqual(await del.json(), { ok: true });

    const bad = await categoryPost(req("/api/communities/kosmovia/categories", "POST", { name: "" }), params({ slug: "kosmovia" }));
    assert.equal(bad.status, 400);

    for (const role of ["member", "moderator"]) {
      const calls = db(role);
      const p = await categoryPost(req("/api/communities/kosmovia/categories", "POST", { name: "x" }), params({ slug: "kosmovia" }));
      assert.equal(p.status, 403, role);
      assert.equal((await p.json()).code, "not_admin");
      const d = await categoryDelete(req(`/api/categories/${CAT}`, "DELETE"), params({ id: CAT }));
      assert.equal(d.status, 403, role);
      assert.ok(!calls.some((c) => c.text.startsWith("delete from") || c.text.startsWith("insert into")));
    }

    db("owner", true);
    assert.equal((await categoryDelete(req(`/api/categories/${CAT}`, "DELETE"), params({ id: CAT }))).status, 404);
    assert.equal((await categoryPatch(req("/api/categories/no-uuid", "PATCH", { name: "x" }), params({ id: "no-uuid" }))).status, 404);
  }),
);

const BOB = { id: bobId, wallet: "G".padEnd(56, "A"), username: "bob", display_name: "Bob", avatar_seed: null, avatar_style: null };
const threadWire = {
  id: THREAD,
  other: { id: bobId, username: "bob", display_name: "Bob", avatar_seed: null, avatar_style: null, wallet: BOB.wallet },
  last_message: null,
  unread: 0,
  last_message_at: "2026-01-01T00:00:00.000000Z",
};

test(
  "POST /api/dms: 201 new, 200 existing, 400 self, 403 no_shared_community, 404 unknown",
  withApiEnv(async () => {
    const db = (opts: { user?: boolean; shared?: boolean; existing?: boolean }) =>
      installPool((text) => {
        if (text.includes("from public.profiles p where lower(p.username)")) return opts.user === false ? [] : [BOB];
        if (text.includes("from public.profiles p where p.id")) return [{ ...BOB, id: aliceId }];
        if (text.startsWith("select exists")) return [{ shared: opts.shared !== false }];
        if (text.startsWith("insert into public.dm_threads")) return opts.existing ? [] : [{ id: THREAD }];
        if (text.includes("from public.dm_threads t where t.user_a = least")) return [{ id: THREAD }];
        if (text.includes("from public.dm_threads t join public.profiles o")) return [threadWire];
        return [];
      });

    db({});
    const created = await dmsPost(req("/api/dms", "POST", { username: "@bob" }));
    assert.equal(created.status, 201);
    assert.deepEqual((await created.json()).thread, threadWire);

    db({ existing: true });
    assert.equal((await dmsPost(req("/api/dms", "POST", { username: "bob" }))).status, 200);

    db({ shared: false });
    const none = await dmsPost(req("/api/dms", "POST", { username: "bob" }));
    assert.equal(none.status, 403);
    assert.equal((await none.json()).code, "no_shared_community");

    db({ user: false });
    assert.equal((await dmsPost(req("/api/dms", "POST", { username: "nadie" }))).status, 404);

    db({});
    const self = await dmsPost(req("/api/dms", "POST", { profileId: aliceId }));
    assert.equal(self.status, 400);
    assert.equal((await self.json()).code, "self_dm");

    assert.equal((await dmsPost(req("/api/dms", "POST", {}))).status, 400);
  }),
);

test(
  "GET /api/dms lists the caller's threads",
  withApiEnv(async () => {
    const calls = installPool((text) => (text.includes("from public.dm_threads t join public.profiles o") ? [threadWire] : []));
    const res = await dmsGet(req("/api/dms", "GET"));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { threads: [threadWire] });
    assert.deepEqual(calls[0].values, [aliceId]);
  }),
);

function dmDb(opts: { participant?: boolean; authorId?: string } = {}) {
  const [a, b] = aliceId < bobId ? [aliceId, bobId] : [bobId, aliceId];
  const [x, y] = opts.participant === false ? [bobId, "66666666-6666-4666-8666-666666666666"].sort() : [a, b];
  const msg = {
    id: MESSAGE,
    thread_id: THREAD,
    channel_id: THREAD,
    author_id: aliceId,
    content: "hola",
    created_at: "2026-01-01T00:00:00.000000Z",
    edited_at: null,
    author: { id: aliceId, username: "alice" },
  };
  return installPool((text) => {
    if (text.startsWith("select t.id, t.user_a, t.user_b")) return [{ id: THREAD, user_a: x, user_b: y }];
    if (text.startsWith("select m.id, m.author_id, t.user_a")) {
      return [{ id: MESSAGE, author_id: opts.authorId ?? aliceId, user_a: x, user_b: y }];
    }
    if (text.includes("from public.dm_messages m join public.profiles a") || text.startsWith("with ins as") || text.startsWith("with upd as")) {
      return [msg];
    }
    if (text.startsWith("update public.dm_threads")) return [{ id: THREAD }];
    if (text.startsWith("delete from public.dm_messages")) return [{ id: MESSAGE }];
    return [];
  });
}

test(
  "DM messages: participants read (and mark read), post, edit and delete their own",
  withApiEnv(async () => {
    const calls = dmDb();
    const list = await dmMessagesGet(req(`/api/dms/${THREAD}/messages`, "GET"), params({ id: THREAD }));
    assert.equal(list.status, 200);
    const { messages } = await list.json();
    assert.equal(messages[0].thread_id, THREAD);
    assert.ok(calls.some((c) => c.text.startsWith("update public.dm_threads t set a_read_at")), "marks the thread read");

    const post = await dmMessagesPost(req(`/api/dms/${THREAD}/messages`, "POST", { content: " hola " }), params({ id: THREAD }));
    assert.equal(post.status, 201);
    assert.deepEqual(calls.find((c) => c.text.startsWith("with ins as"))?.values, [THREAD, aliceId, "hola"]);

    const edit = await dmMessagePatch(req(`/api/dms/${THREAD}/messages/${MESSAGE}`, "PATCH", { content: "nuevo" }), params({ id: THREAD, messageId: MESSAGE }));
    assert.equal(edit.status, 200);
    const del = await dmMessageDelete(req(`/api/dms/${THREAD}/messages/${MESSAGE}`, "DELETE"), params({ id: THREAD, messageId: MESSAGE }));
    assert.equal(del.status, 200);
    assert.deepEqual(await del.json(), { ok: true });
  }),
);

test(
  "DM messages: someone outside the thread gets 404 and nothing runs; a participant cannot touch the other person's message",
  withApiEnv(async () => {
    const calls = dmDb({ participant: false });
    assert.equal((await dmMessagesGet(req(`/api/dms/${THREAD}/messages`, "GET"), params({ id: THREAD }))).status, 404);
    assert.equal((await dmMessagesPost(req(`/api/dms/${THREAD}/messages`, "POST", { content: "x" }), params({ id: THREAD }))).status, 404);
    assert.equal((await dmMessagePatch(req(`/api/dms/${THREAD}/messages/${MESSAGE}`, "PATCH", { content: "x" }), params({ id: THREAD, messageId: MESSAGE }))).status, 404);
    assert.equal((await dmMessageDelete(req(`/api/dms/${THREAD}/messages/${MESSAGE}`, "DELETE"), params({ id: THREAD, messageId: MESSAGE }))).status, 404);
    assert.ok(!calls.some((c) => /^(with|insert|delete|update)/.test(c.text)), "no write ran");

    const other = dmDb({ authorId: bobId });
    const edit = await dmMessagePatch(req(`/api/dms/${THREAD}/messages/${MESSAGE}`, "PATCH", { content: "x" }), params({ id: THREAD, messageId: MESSAGE }));
    assert.equal(edit.status, 403);
    assert.equal((await edit.json()).code, "not_author");
    const del = await dmMessageDelete(req(`/api/dms/${THREAD}/messages/${MESSAGE}`, "DELETE"), params({ id: THREAD, messageId: MESSAGE }));
    assert.equal(del.status, 403);
    assert.ok(!other.some((c) => c.text.startsWith("delete from")));
  }),
);
