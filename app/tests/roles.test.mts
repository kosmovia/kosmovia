/**
 * Roles (owner/admin/moderator/member) and deletion: pure rules, SQL builders,
 * migration 0006 and the routes with a fake pool. No network, no database.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";
import { Keypair } from "@stellar/stellar-base";

import { DELETE as channelDelete } from "../app/api/channels/[id]/route.ts";
import { DELETE as communityDelete } from "../app/api/communities/[slug]/route.ts";
import { PATCH as memberPatch } from "../app/api/communities/[slug]/members/[profileId]/route.ts";
import { parseRoleChange } from "../lib/core/api-input.ts";
import { resetApiLimits } from "../lib/core/api-limits.ts";
import {
  canAssignRole,
  canDeleteChannel,
  canDeleteCommunity,
  canPostInChannel,
  isAdminRole,
  roleOf,
  type Role,
} from "../lib/core/authz.ts";
import { profileIdFromWallet } from "../lib/core/ids.ts";
import { asRole } from "../lib/core/mappers.ts";
import * as q from "../lib/core/db/sql.ts";
import { SESSION_COOKIE, signSessionCookie } from "../lib/core/session-cookie.ts";

const HOSTILE = ["x'; drop table members; --", "1 or 1=1", "$1; select pg_sleep(10)", "\"; delete from channels; --"];

const ROLES: Role[] = [null, "member", "moderator", "admin", "owner"];

// ---------------------------------------------------------------- pure rules

test("roleOf and asRole know the moderator role", () => {
  assert.equal(roleOf("moderator"), "moderator");
  assert.equal(asRole("moderator"), "moderator");
  assert.equal(roleOf("superuser"), null);
  assert.equal(asRole(undefined), null);
});

test("moderator is not an admin role and cannot post in announcement channels", () => {
  assert.equal(isAdminRole("moderator"), false);
  assert.equal(canPostInChannel("moderator", "text").allowed, true);
  assert.equal(canPostInChannel("moderator", "announcement").allowed, false);
});

test("canAssignRole: owner changes anyone but the owner, to admin/moderator/member", () => {
  for (const target of ["member", "moderator", "admin"] as const) {
    for (const next of ["admin", "moderator", "member"] as const) {
      assert.equal(canAssignRole("owner", target, next).allowed, true, `owner ${target}->${next}`);
    }
  }
  const protectedOwner = canAssignRole("owner", "owner", "member");
  assert.ok(!protectedOwner.allowed && protectedOwner.code === "owner_protected");
});

test("canAssignRole: admin only moves moderator/member between moderator/member", () => {
  for (const target of ["member", "moderator"] as const) {
    for (const next of ["moderator", "member"] as const) {
      assert.equal(canAssignRole("admin", target, next).allowed, true, `admin ${target}->${next}`);
    }
    const makeAdmin = canAssignRole("admin", target, "admin");
    assert.ok(!makeAdmin.allowed && makeAdmin.code === "owner_only", `admin cannot create admins from ${target}`);
  }
  for (const next of ["moderator", "member", "admin"] as const) {
    const d = canAssignRole("admin", "admin", next);
    assert.ok(!d.allowed && d.code === "owner_only", `admin cannot touch an admin (${next})`);
  }
  const d = canAssignRole("admin", "owner", "member");
  assert.ok(!d.allowed && d.code === "owner_protected");
});

test("canAssignRole: moderator, member and outsiders cannot assign; owner is never assignable; the target must be a member", () => {
  for (const actor of [null, "member", "moderator"] as const) {
    for (const target of ROLES) {
      for (const next of ["admin", "moderator", "member"] as const) {
        assert.equal(canAssignRole(actor, target, next).allowed, false, `${actor} ${target}->${next}`);
      }
    }
  }
  for (const actor of ["admin", "owner"] as const) {
    for (const bad of ["owner", "superuser", "", null, undefined, 3]) {
      const d = canAssignRole(actor, "member", bad);
      assert.ok(!d.allowed && d.code === "invalid_role", `${actor} -> ${String(bad)}`);
    }
    const missing = canAssignRole(actor, null, "member");
    assert.ok(!missing.allowed && missing.code === "target_not_member");
  }
});

test("canDeleteChannel: owner/admin, never #general, nobody else", () => {
  const expected: Record<string, boolean> = { null: false, member: false, moderator: false, admin: true, owner: true };
  for (const role of ROLES) {
    assert.equal(canDeleteChannel(role, "ideas").allowed, expected[String(role)], `${role}/ideas`);
    const general = canDeleteChannel(role, "general");
    assert.equal(general.allowed, false, `${role}/general`);
    if (role === "owner" || role === "admin") assert.ok(!general.allowed && general.status === 400 && general.code === "general_protected");
  }
  // #anuncios is a normal channel for this rule.
  assert.equal(canDeleteChannel("admin", "anuncios").allowed, true);
});

test("canDeleteCommunity: owner only", () => {
  for (const role of ROLES) assert.equal(canDeleteCommunity(role).allowed, role === "owner", String(role));
  const d = canDeleteCommunity("admin");
  assert.ok(!d.allowed && d.status === 403 && d.code === "not_owner");
});

test("parseRoleChange accepts admin/moderator/member and nothing else", () => {
  for (const role of ["admin", "moderator", "member"]) assert.deepEqual(parseRoleChange({ role }), { ok: true, value: { role } });
  for (const bad of [{ role: "owner" }, { role: "x" }, { role: 1 }, {}, null, [], "admin", { role: "ADMIN" }]) {
    assert.equal(parseRoleChange(bad).ok, false, JSON.stringify(bad));
  }
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

test("setMemberRole is parameterized and re-checks authorization inside the UPDATE", () => {
  const [a, b, c, d] = HOSTILE;
  const query = q.setMemberRole(a, b, c, d);
  assertParameterized(query, [a, b, c, d]);
  assert.deepEqual(query.values, [a, b, c, d]);
  assert.match(query.text, /update public\.members t set role = \$3/);
  assert.match(query.text, /t\.role <> 'owner'/);
  assert.match(query.text, /\$3 in \('admin', 'moderator', 'member'\)/);
  assert.match(query.text, /a\.role = 'owner'/);
  assert.match(query.text, /a\.role = 'admin' and \$3 in \('moderator', 'member'\) and t\.role in \('moderator', 'member'\)/);
  assert.match(query.text, /returning/);
});

test("deleteChannel is parameterized, spares #general and demands owner/admin in the DELETE itself", () => {
  const [a, b] = HOSTILE;
  const query = q.deleteChannel(a, b);
  assertParameterized(query, [a, b]);
  assert.match(query.text, /^delete from public\.channels ch where ch\.id = \$1 and ch\.name <> 'general'/);
  assert.match(query.text, /m\.role in \('owner', 'admin'\)/);
  assert.match(query.text, /m\.profile_id = \$2::uuid/);
});

test("deleteCommunity is parameterized and only matches the owner", () => {
  const [a, b] = HOSTILE;
  const query = q.deleteCommunity(a, b);
  assertParameterized(query, [a, b]);
  assert.equal(query.text, "delete from public.communities where slug = $1 and owner_id = $2 returning id");
});

// ---------------------------------------------------------------- migration

const migration = readFileSync(new URL("../db/migrations/0006_roles_y_borrado.sql", import.meta.url), "utf8");
const code = migration.replace(/--.*$/gm, "");

test("0006: members.role CHECK allows moderator and is re-created idempotently", () => {
  assert.match(code, /drop constraint if exists members_role_check/i);
  assert.match(code, /add constraint members_role_check\s+check \(role in \('owner', 'admin', 'moderator', 'member'\)\)/i);
});

test("0006: deletes cascade from communities to members/channels and from channels to messages, payments untouched", () => {
  assert.match(code, /on delete cascade/i);
  assert.match(code, /'public\.members'::regclass\s+and c\.confrelid = 'public\.communities'::regclass/);
  assert.match(code, /'public\.channels'::regclass and c\.confrelid = 'public\.communities'::regclass/);
  assert.match(code, /'public\.messages'::regclass and c\.confrelid = 'public\.channels'::regclass/);
  assert.doesNotMatch(code, /payments/i);
  // Keeps the constraint names: drop and add use the same %I.
  assert.match(code, /drop constraint %I, add constraint %I foreign key/);
  // 0001 already cascades those three relations.
  const stageA = readFileSync(new URL("../db/migrations/0001_stage_a.sql", import.meta.url), "utf8");
  assert.match(stageA, /community_id uuid not null references public\.communities \(id\) on delete cascade/);
  assert.match(stageA, /channel_id uuid not null references public\.channels \(id\) on delete cascade/);
});

test("0006 has none of the Supabase-only pieces", () => {
  for (const banned of [/auth\.jwt\(/i, /row level security/i, /create policy/i, /\bgrant\b/i, /security definer/i]) {
    assert.doesNotMatch(code, banned, String(banned));
  }
});

// ---------------------------------------------------------------- routes

const POOL_KEY = Symbol.for("kosmovia.pg.pool");
const SECRET = randomBytes(24).toString("hex");
const COMMUNITY = "22222222-2222-4222-8222-222222222222";
const CHANNEL = "11111111-1111-4111-8111-111111111111";
const alice = Keypair.random();
const bob = Keypair.random();
const aliceId = profileIdFromWallet(alice.publicKey());
const bobId = profileIdFromWallet(bob.publicKey());

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

const cookieFor = (kp: Keypair) =>
  `${SESSION_COOKIE}=${signSessionCookie({ secret: Buffer.from(SECRET), wallet: kp.publicKey() }).token}`;

function req(path: string, method: string, cookie?: string, body?: unknown): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://kosmovia.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const communityRow = { id: COMMUNITY, slug: "mi-comunidad", name: "Mi comunidad", icon: "", description: "", owner_id: aliceId };

/** Fake DB for the member-role route: alice has `actor`, bob has `target`. */
function roleDb(actor: string | null, target: string | null, updated = true) {
  return (text: string, values: unknown[]) => {
    if (text.includes("from public.communities c where c.slug")) return [communityRow];
    if (text.startsWith("select role from public.members")) {
      const who = values[1] === aliceId ? actor : target;
      return who ? [{ role: who }] : [];
    }
    if (text.includes("update public.members t set role")) {
      return updated ? [{ role: values[2], joined_at: "2026-01-01T00:00:00Z", profile: { id: values[1], username: "bob" } }] : [];
    }
    return [];
  };
}

const role = (r: unknown) => ({ role: r });

test(
  "PATCH member role: owner makes an admin; the member comes back with the new role",
  withApiEnv(async () => {
    const calls = installPool(roleDb("owner", "member"));
    const res = await memberPatch(
      req(`/api/communities/mi-comunidad/members/${bobId}`, "PATCH", cookieFor(alice), role("admin")),
      params({ slug: "mi-comunidad", profileId: bobId }),
    );
    assert.equal(res.status, 200);
    assert.equal((await res.json()).member.role, "admin");
    const update = calls.find((c) => c.text.includes("update public.members t set role"));
    assert.deepEqual(update?.values, [COMMUNITY, bobId, "admin", aliceId]);
  }),
);

test(
  "PATCH member role: admin cannot create admins nor touch the owner; moderators and members cannot assign; no UPDATE is attempted",
  withApiEnv(async () => {
    const cases: Array<[string, string, string, string]> = [
      ["admin", "member", "admin", "owner_only"],
      ["admin", "admin", "member", "owner_only"],
      ["admin", "owner", "member", "owner_protected"],
      ["owner", "owner", "member", "owner_protected"],
      ["moderator", "member", "moderator", "not_admin"],
      ["member", "member", "moderator", "not_admin"],
    ];
    for (const [actor, target, next, code] of cases) {
      const calls = installPool(roleDb(actor, target));
      const res = await memberPatch(
        req(`/api/communities/mi-comunidad/members/${bobId}`, "PATCH", cookieFor(alice), role(next)),
        params({ slug: "mi-comunidad", profileId: bobId }),
      );
      assert.equal(res.status, 403, `${actor}/${target}/${next}`);
      assert.equal((await res.json()).code, code);
      assert.ok(!calls.some((c) => c.text.includes("update public.members")));
    }
  }),
);

test(
  "PATCH member role: 400 for owner or garbage roles and bad ids, 404 for a non-member target, 403 when the UPDATE matches nothing, 401 without session",
  withApiEnv(async () => {
    installPool(roleDb("owner", "member"));
    const patch = (profileId: string, body: unknown, cookie: string | null = cookieFor(alice)) =>
      memberPatch(req(`/api/communities/mi-comunidad/members/${profileId}`, "PATCH", cookie ?? undefined, body), params({ slug: "mi-comunidad", profileId }));
    assert.equal((await patch(bobId, role("owner"))).status, 400);
    assert.equal((await patch(bobId, role("x'; drop table members; --"))).status, 400);
    assert.equal((await patch(bobId, {})).status, 400);
    assert.equal((await patch("not-a-uuid", role("member"))).status, 400);
    assert.equal((await patch(bobId, role("member"), null)).status, 401);

    installPool(roleDb("owner", null));
    assert.equal((await patch(bobId, role("member"))).status, 404);

    installPool(roleDb("owner", "member", false));
    assert.equal((await patch(bobId, role("member"))).status, 403);
  }),
);

test(
  "DELETE community: the owner deletes; a non-owner gets 403 not_owner; a missing slug is 404",
  withApiEnv(async () => {
    const calls = installPool((text) => (text.startsWith("delete from public.communities") ? [{ id: COMMUNITY }] : []));
    const ok = await communityDelete(req("/api/communities/mi-comunidad", "DELETE", cookieFor(alice)), params({ slug: "mi-comunidad" }));
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true });
    assert.deepEqual(calls[0].values, ["mi-comunidad", aliceId]);

    installPool((text) => (text.includes("from public.communities c where c.slug") ? [communityRow] : []));
    const denied = await communityDelete(req("/api/communities/mi-comunidad", "DELETE", cookieFor(bob)), params({ slug: "mi-comunidad" }));
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, "not_owner");

    installPool(() => []);
    assert.equal((await communityDelete(req("/api/communities/nada", "DELETE", cookieFor(alice)), params({ slug: "nada" }))).status, 404);
    assert.equal((await communityDelete(req("/api/communities/mi-comunidad", "DELETE"), params({ slug: "mi-comunidad" }))).status, 401);
  }),
);

/** Fake DB for the channel route: the caller has `callerRole` in a channel called `name`. */
function channelDb(callerRole: string | null, name: string) {
  return (text: string) => {
    if (text.includes("left join public.members")) return [{ id: CHANNEL, community_id: COMMUNITY, name, type: "text", role: callerRole }];
    if (text.startsWith("delete from public.channels")) return [{ id: CHANNEL }];
    return [];
  };
}

test(
  "DELETE channel: owner and admin delete; others get 403; #general is a 400 and never reaches the DELETE; unknown channel is 404",
  withApiEnv(async () => {
    const del = (id = CHANNEL) => channelDelete(req(`/api/channels/${id}`, "DELETE", cookieFor(alice)), params({ id }));

    for (const r of ["owner", "admin"]) {
      const calls = installPool(channelDb(r, "ideas"));
      const res = await del();
      assert.equal(res.status, 200, r);
      assert.deepEqual(await res.json(), { ok: true });
      assert.deepEqual(calls.find((c) => c.text.startsWith("delete from public.channels"))?.values, [CHANNEL, aliceId]);
    }

    for (const r of ["moderator", "member", null]) {
      const calls = installPool(channelDb(r, "ideas"));
      assert.equal((await del()).status, 403, String(r));
      assert.ok(!calls.some((c) => c.text.startsWith("delete from")));
    }

    const calls = installPool(channelDb("owner", "general"));
    const general = await del();
    assert.equal(general.status, 400);
    assert.equal((await general.json()).code, "general_protected");
    assert.ok(!calls.some((c) => c.text.startsWith("delete from")));

    installPool(() => []);
    assert.equal((await del()).status, 404);
    assert.equal((await del("not-a-uuid")).status, 404);
  }),
);
