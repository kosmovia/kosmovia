/** SQL of the api backend: parameterization (no user input in the text), the plain-Postgres migration, pool config. No network, no database. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildPoolConfig, describeConnectionError, parseSslMode, readDbConfig } from "../lib/core/db/config.ts";
import { classifyDbError } from "../lib/core/db/errors.ts";
import * as q from "../lib/core/db/sql.ts";
import { AVATAR_STYLES } from "../lib/core/avatar/generator.ts";

const HOSTILE = [
  "x'; drop table profiles; --",
  "1 or 1=1",
  "$1; select pg_sleep(10)",
  "\"; delete from messages; --",
  "Robert'); drop table communities;--",
];

/** The text has only constants and $n; every $n 1..N is used once the values are N. */
function assertParameterized(query: q.Query, hostile: string[] = HOSTILE) {
  for (const bad of hostile) {
    assert.ok(!query.text.includes(bad), `user input leaked into the SQL text: ${bad}`);
    assert.ok(query.values.includes(bad), `the value must travel in values: ${bad}`);
  }
  const used = new Set([...query.text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  assert.equal(Math.max(0, ...used), query.values.length, "placeholder count must equal values count");
  for (let i = 1; i <= query.values.length; i += 1) assert.ok(used.has(i), `$${i} is never used`);
  // No string concatenation of values: the text has no quoted user data, only fixed literals.
  assert.doesNotMatch(query.text, /\$\{|undefined|\[object/);
}

test("every builder keeps hostile input out of the SQL text and in values", () => {
  const [a, b, c, d] = HOSTILE;
  assertParameterized(q.profileById(a), [a]);
  assertParameterized(q.profileByUsername(a), [a]);
  assertParameterized(
    q.insertProfile({ id: a, wallet: b, username: c, displayName: d, avatarSeed: HOSTILE[4], avatarStyle: "1 or 1=1" }),
    [a, b, c, d, HOSTILE[4]],
  );
  const update = q.updateProfile(a, { username: b, displayName: c, avatarSeed: d, avatarStyle: HOSTILE[4], bio: "1 or 1=1" });
  assert.ok(update);
  assertParameterized(update, HOSTILE);
  assertParameterized(q.persistXVerification(a, b, c, d), [a, b, c, d]);
  assertParameterized(q.profileTrustLevel(a, b), [a, b]);
  assertParameterized(q.listCommunities(100), []);
  assertParameterized(q.communityBySlug(a), [a]);
  assertParameterized(q.myCommunityIds(a), [a]);
  assertParameterized(q.insertCommunity({ name: a, slug: b, description: c, icon: d, ownerId: HOSTILE[4], image: a }), HOSTILE);
  assertParameterized(q.updateCommunityImage(a, b, c), [a, b, c]);
  assertParameterized(q.joinCommunity(a, b), [a, b]);
  assertParameterized(q.memberRole(a, b), [a, b]);
  assertParameterized(q.listMembers(a), [a]);
  assertParameterized(q.listChannels(a), [a]);
  assertParameterized(q.insertChannel({ communityId: a, name: b, topic: c, type: "text" }), [a, b, c]);
  assertParameterized(q.channelWithRole(a, b), [a, b]);
  assertParameterized(q.messagesNewest(a, 50), [a]);
  assertParameterized(q.messagesNewest(a, 50, b), [a, b]);
  assertParameterized(q.messagesAfter(a, b, 100), [a, b]);
  assertParameterized(q.insertMessage(a, b, "1 or 1=1; -- hola"), [a, b, "1 or 1=1; -- hola"]);
});

test("updateProfile only ever touches the five self-service columns, and says nothing when empty", () => {
  assert.equal(q.updateProfile("id", {}), null);
  // Fields outside the patch type (a hostile body that slipped through) are never written.
  const sneaky = q.updateProfile("id", { bio: "hi", trust_level: 2, x_handle: "evil", wallet: "G...", id: "other" } as never);
  assert.ok(sneaky);
  assert.match(sneaky.text, /set bio = \$2 where id = \$1/);
  assert.doesNotMatch(sneaky.text.split("returning")[0], /trust_level|x_handle|x_verified_at|wallet/);
  assert.deepEqual(sneaky.values, ["id", "hi"]);
  const all = q.updateProfile("id", { username: "u", displayName: "d", avatarSeed: "s", avatarStyle: "planet", bio: "b" });
  assert.ok(all);
  assert.match(all.text, /set username = \$2, display_name = \$3, avatar_seed = \$4, avatar_style = \$5, bio = \$6 where id = \$1/);
});

test("insertProfile writes no trust or X columns: they keep their defaults", () => {
  const { text } = q.insertProfile({ id: "i", wallet: "w", username: "u", displayName: "", avatarSeed: null, avatarStyle: null });
  const columns = text.split("values")[0];
  assert.match(columns, /\(id, wallet, username, display_name, avatar_seed, avatar_style\)/);
  assert.doesNotMatch(columns, /trust_level|x_handle|x_verified_at/);
});

test("X verification: level 1 never 2, never touches a level-2 profile, row must match id and wallet", () => {
  const { text } = q.persistXVerification("i", "w", "h", "2026-10-02T00:00:00.000Z");
  assert.match(text, /trust_level = 1/);
  assert.doesNotMatch(text, /trust_level = 2/);
  assert.match(text, /trust_level < 2/);
  assert.match(text, /where id = \$1 and wallet = \$2/);
});

test("message insert enforces membership and the announcement rule inside the INSERT itself", () => {
  const { text } = q.insertMessage("c", "a", "hi");
  assert.match(text, /join public\.members mem on mem\.community_id = ch\.community_id and mem\.profile_id = \$2::uuid/);
  assert.match(text, /\(ch\.type = 'text' or mem\.role in \('owner', 'admin'\)\)/);
});

test("message pages: cursors resolve inside the channel, order is stable, size is clamped", () => {
  const newest = q.messagesNewest("c", 50);
  assert.match(newest.text, /order by m\.created_at desc, m\.id desc limit \$2/);
  const older = q.messagesNewest("c", 50, "m");
  assert.match(older.text, /\(m\.created_at, m\.id\) < \(select b\.created_at, b\.id from public\.messages b where b\.id = \$2 and b\.channel_id = \$1\)/);
  const after = q.messagesAfter("c", "m", 100);
  assert.match(after.text, /b\.id = \$2 and b\.channel_id = \$1/);
  assert.match(after.text, /make_interval\(secs => 5\)/);
  assert.match(after.text, /order by m\.created_at asc, m\.id asc limit \$3/);
  assert.equal(q.pageSize(undefined), 50);
  assert.equal(q.pageSize(0), 1);
  assert.equal(q.pageSize(-5), 1);
  assert.equal(q.pageSize(5000), q.MAX_PAGE);
  assert.equal(q.pageSize(7.9), 7);
  assert.equal(q.pageSize(Number.NaN), 50);
});

test("message rows carry a microsecond ISO timestamp and the slim author only", () => {
  const { text } = q.messagesNewest("c", 10);
  assert.match(text, /to_char\(m\.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS\.US"Z"'\) as created_at/);
  const author = /json_build_object\(([^)]*)\) as author/.exec(text)?.[1] ?? "";
  assert.match(author, /'id'.*'username'.*'display_name'.*'avatar_seed'.*'avatar_style'/);
  assert.doesNotMatch(author, /wallet|bio|trust_level|x_handle/);
});

// ---------------------------------------------------------------- migration

const sql = readFileSync(new URL("../db/migrations/0001_stage_a.sql", import.meta.url), "utf8");
const code = sql.replace(/--.*$/gm, "");

test("the plain-Postgres migration has none of the Supabase-only pieces", () => {
  for (const banned of [
    /auth\.jwt\(/i,
    /row level security/i,
    /create policy/i,
    /\bgrant\b/i,
    /\brevoke\b/i,
    /\banon\b/i,
    /\bauthenticated\b/i,
    /\bauthenticator\b/i,
    /supabase_realtime/i,
    /kosmovia_verifier/i,
    /create role/i,
    /security definer/i,
  ]) {
    assert.doesNotMatch(code, banned, String(banned));
  }
});

test("the migration is idempotent: IF NOT EXISTS, OR REPLACE, DROP TRIGGER IF EXISTS before each trigger", () => {
  for (const m of code.matchAll(/create table\s+(?!if not exists)/gi)) assert.fail(`create table without IF NOT EXISTS at ${m.index}`);
  for (const m of code.matchAll(/create (unique )?index\s+(?!if not exists)/gi)) assert.fail(`create index without IF NOT EXISTS at ${m.index}`);
  for (const m of code.matchAll(/create function/gi)) assert.fail(`create function without OR REPLACE at ${m.index}`);
  const triggers = [...code.matchAll(/create trigger (\w+)/gi)].map((m) => m[1]);
  assert.equal(triggers.length, 4);
  for (const t of triggers) assert.match(code, new RegExp(`drop trigger if exists ${t} on`, "i"), t);
});

test("the migration keeps the tables, CHECKs, indexes, quotas and the community trigger of 0001 + 0002", () => {
  for (const t of ["profiles", "communities", "members", "channels", "messages"]) {
    assert.match(code, new RegExp(`create table if not exists public\\.${t} `, "i"), t);
  }
  for (const piece of [
    "profiles_username_format",
    "profiles_avatar_seed_safe",
    "profiles_avatar_style_known",
    "profiles_x_handle_format",
    "communities_slug_format",
    "channels_name_format",
    "profiles_username_lower_key",
    "profiles_x_handle_lower_key",
    "messages_channel_created_idx",
    "communities_owner_created_idx",
    "messages_author_created_idx",
    "on_community_created",
    "'general'",
    "'anuncios'",
  ]) {
    assert.ok(code.includes(piece), piece);
  }
  // Quotas: same numbers and messages as 0002_hardening.sql.
  for (const piece of [
    "v_total >= 10",
    "v_day >= 3",
    "v_minute >= 20",
    "v_hour >= 500",
    "v_count >= 50",
    "quota_exceeded:communities_total",
    "quota_exceeded:communities_per_day",
    "quota_exceeded:messages_per_minute",
    "quota_exceeded:messages_per_hour",
    "quota_exceeded:channels_per_community",
    "pg_advisory_xact_lock",
  ]) {
    assert.ok(code.includes(piece), piece);
  }
});

test("the latest migration lists exactly the avatar styles of the generator", () => {
  const latest = readFileSync(new URL("../db/migrations/0002_kosmonautas.sql", import.meta.url), "utf8");
  const listed = /avatar_style in\s*\(([^)]*)\)/.exec(latest)?.[1] ?? "";
  const styles = [...listed.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...styles].sort(), [...AVATAR_STYLES].sort());
});

test("constraint names the error mapper relies on exist in the migration", () => {
  for (const name of [
    "profiles_username_lower_key",
    "profiles_x_handle_lower_key",
    "communities_slug_key",
    "channels_community_name_key",
    "profiles_wallet_key",
  ]) {
    assert.ok(code.includes(name), name);
  }
});

test("0002 keeps one profile per Kosmonauta and maps the duplicate to avatar_taken", () => {
  const latest = readFileSync(new URL("../db/migrations/0002_kosmonautas.sql", import.meta.url), "utf8");
  assert.match(latest, /create unique index if not exists profiles_kosmonauta_key\s+on public\.profiles \(avatar_seed\) where avatar_style = 'kosmonauta'/);
  assert.match(latest, /add constraint profiles_kosmonauta_code/);
  const dup = classifyDbError({ code: "23505", constraint: "profiles_kosmonauta_key" });
  assert.equal(dup.status, 409);
  assert.equal(dup.code, "avatar_taken");
});

// ------------------------------------------------------------------- errors

test("quota errors map to the Spanish messages, other database errors never echo the driver", () => {
  const quota = classifyDbError({ code: "P0001", message: "quota_exceeded:messages_per_minute" });
  assert.equal(quota.status, 429);
  assert.equal(quota.code, "quota_exceeded");
  assert.match(quota.error, /Vas muy rápido/);
  assert.match(classifyDbError({ code: "P0001", message: "quota_exceeded:communities_per_day" }).error, /3 comunidades/);
  assert.match(classifyDbError({ code: "P0001", message: "quota_exceeded:communities_total" }).error, /10 comunidades/);
  assert.match(classifyDbError({ code: "P0001", message: "quota_exceeded:channels_per_community" }).error, /50 canales/);
  assert.match(classifyDbError({ code: "P0001", message: "quota_exceeded:messages_per_hour" }).error, /por hora/);
  // A P0001 that is not a quota is a plain failure.
  assert.equal(classifyDbError({ code: "P0001", message: "something else" }).status, 500);

  assert.equal(classifyDbError({ code: "23505", constraint: "profiles_username_lower_key" }).code, "username_taken");
  assert.equal(classifyDbError({ code: "23505", constraint: "profiles_x_handle_lower_key" }).code, "x_taken");
  assert.equal(classifyDbError({ code: "23505", constraint: "communities_slug_key" }).code, "slug_taken");
  assert.equal(classifyDbError({ code: "23505", constraint: "profiles_pkey" }).code, "profile_exists");
  assert.equal(classifyDbError({ code: "23503" }).code, "no_profile");
  assert.equal(classifyDbError({ code: "23514" }).status, 400);

  const secret = "postgresql://user:hunter2@host/db";
  const unknown = classifyDbError({ code: "XX000", message: `boom ${secret}` });
  assert.equal(unknown.status, 500);
  assert.ok(!JSON.stringify(unknown).includes("hunter2"));
  assert.equal(classifyDbError(null).status, 500);
});

// -------------------------------------------------------------------- config

test("pool config: verified TLS by default, off for localhost, never echoes the URL", () => {
  const remote = buildPoolConfig("postgresql://user:p%40ss@db.example.test/kosmo");
  assert.deepEqual(remote.ssl, { rejectUnauthorized: true });
  assert.equal(remote.host, "db.example.test");
  assert.equal(remote.port, 5432);
  assert.equal(remote.user, "user");
  assert.equal(remote.password, "p@ss");
  assert.equal(remote.database, "kosmo");
  assert.equal(remote.max, 5);

  assert.equal(buildPoolConfig("postgres://u:p@localhost:5433/d").ssl, false);
  assert.equal(buildPoolConfig("postgres://u:p@localhost:5433/d").port, 5433);
  assert.deepEqual(buildPoolConfig("postgres://u:p@db.example.test/d", { ssl: "no-verify" }).ssl, { rejectUnauthorized: false });
  assert.equal(buildPoolConfig("postgres://u:p@db.example.test/d", { ssl: "off" }).ssl, false);
  // ?sslmode= in the URL must not change the policy decided here.
  assert.deepEqual(buildPoolConfig("postgres://u:p@db.example.test/d?sslmode=disable").ssl, { rejectUnauthorized: true });

  for (const bad of ["not a url", "mysql://u:hunter2@h/d", "postgresql://u:hunter2@/d", "postgresql://u:hunter2@h/"]) {
    assert.throws(
      () => buildPoolConfig(bad),
      (err: Error) => !err.message.includes("hunter2") && !err.message.includes(bad),
      bad,
    );
  }
});

test("readDbConfig: null without DATABASE_URL, DATABASE_SSL picks the policy", () => {
  assert.equal(readDbConfig({}), null);
  assert.equal(readDbConfig({ DATABASE_URL: "  " }), null);
  assert.deepEqual(readDbConfig({ DATABASE_URL: "postgres://u:p@h.test/d", DATABASE_SSL: "no-verify" })?.ssl, {
    rejectUnauthorized: false,
  });
  assert.equal(parseSslMode("VERIFY"), "verify");
  assert.equal(parseSslMode("whatever"), undefined);
});

test("describeConnectionError never leaks hosts or messages of network errors", () => {
  const net = describeConnectionError({ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND dpg-secret-host.render.com" });
  assert.equal(net, "ENOTFOUND");
  assert.match(describeConnectionError({ code: "SELF_SIGNED_CERT_IN_CHAIN", message: "x" }), /certificado/);
  assert.equal(describeConnectionError({ code: "42P07", severity: "ERROR", message: 'relation "x" already exists' }), '42P07: relation "x" already exists');
  assert.equal(describeConnectionError(new Error("password for user x failed")), "unknown");
});
