/**
 * Descripción de la comunidad: PATCH /api/communities/[slug] { description }.
 * Regla pura (owner/admin), parseo (0..280, '' la quita), SQL y ruta con un pool falso.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { afterEach } from "node:test";
import { Keypair } from "@stellar/stellar-base";

import { PATCH as communityPatch } from "../app/api/communities/[slug]/route.ts";
import { DESCRIPTION_MAX, parseCommunityDescription } from "../lib/core/api-input.ts";
import { resetApiLimits } from "../lib/core/api-limits.ts";
import { canEditCommunityDescription, type Role } from "../lib/core/authz.ts";
import * as q from "../lib/core/db/sql.ts";
import { SESSION_COOKIE, signSessionCookie } from "../lib/core/session-cookie.ts";

const ROLES: Role[] = [null, "member", "moderator", "admin", "owner"];

test("canEditCommunityDescription: owner and admin only", () => {
  for (const role of ROLES) {
    assert.equal(canEditCommunityDescription(role).allowed, role === "owner" || role === "admin", String(role));
  }
  const d = canEditCommunityDescription("moderator");
  assert.ok(!d.allowed && d.status === 403 && d.code === "not_admin");
  const outsider = canEditCommunityDescription(null);
  assert.ok(!outsider.allowed && outsider.code === "not_member");
});

test("parseCommunityDescription: trimmed 0..280; empty is ''; anything else is rejected", () => {
  assert.equal(DESCRIPTION_MAX, 280);
  assert.deepEqual(parseCommunityDescription("  Hola  "), { ok: true, value: "Hola" });
  assert.deepEqual(parseCommunityDescription(""), { ok: true, value: "" });
  assert.deepEqual(parseCommunityDescription("   "), { ok: true, value: "" });
  assert.equal(parseCommunityDescription("a".repeat(280)).ok, true);
  for (const bad of ["a".repeat(281), 3, null, undefined, {}, []]) {
    assert.equal(parseCommunityDescription(bad).ok, false, JSON.stringify(bad));
  }
});

test("updateCommunityDescription is parameterized and demands owner/admin in the UPDATE itself", () => {
  const hostile = ["x'; drop table communities; --", "1 or 1=1", "$1; select pg_sleep(10)"];
  const query = q.updateCommunityDescription(hostile[0], hostile[1], hostile[2]);
  assert.deepEqual(query.values, hostile);
  for (const bad of hostile) assert.ok(!query.text.includes(bad));
  assert.match(query.text, /^update public\.communities c set description = \$3 where c\.slug = \$1/);
  assert.match(query.text, /m\.role in \('owner', 'admin'\)/);
  assert.match(query.text, /m\.profile_id = \$2::uuid/);
});

// ------------------------------------------------------------------- route

const POOL_KEY = Symbol.for("kosmovia.pg.pool");
const SECRET = randomBytes(24).toString("hex");
const COMMUNITY = "22222222-2222-4222-8222-222222222222";
const alice = Keypair.random();

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

function patch(body: unknown, withCookie = true): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (withCookie) headers.cookie = cookie;
  return new Request("https://kosmovia.test/api/communities/mi-comu", { method: "PATCH", headers, body: JSON.stringify(body) });
}
const ctx = { params: Promise.resolve({ slug: "mi-comu" }) };

const COMMUNITY_ROW = {
  id: COMMUNITY,
  slug: "mi-comu",
  name: "Mi comu",
  icon: "",
  description: "nueva",
  owner_id: "o",
  created_at: "2026-01-01T00:00:00.000000Z",
  image: null,
};

/** Fake DB: alice has `role`; `writeMatches` = the UPDATE found a row. */
function communityDb(role: string | null, opts: { missing?: boolean; writeMatches?: boolean } = {}) {
  const writeMatches = opts.writeMatches ?? true;
  return (text: string) => {
    if (text.includes("from public.communities c where c.slug")) return opts.missing ? [] : [COMMUNITY_ROW];
    if (text.startsWith("select role from public.members")) return role ? [{ role }] : [];
    if (text.startsWith("update public.communities c set description")) return writeMatches ? [COMMUNITY_ROW] : [];
    return [];
  };
}

test(
  "PATCH community { description }: owner and admin save it (trimmed) and get the community back",
  withApiEnv(async () => {
    for (const role of ["owner", "admin"]) {
      const calls = installPool(communityDb(role));
      const res = await communityPatch(patch({ description: "  nueva  " }), ctx);
      assert.equal(res.status, 200, role);
      assert.equal((await res.json()).community.description, "nueva");
      const update = calls.find((c) => c.text.startsWith("update public.communities c set description"));
      assert.equal(update?.values[0], "mi-comu");
      assert.equal(update?.values[2], "nueva");
    }
    const calls = installPool(communityDb("admin"));
    assert.equal((await communityPatch(patch({ description: "" }), ctx)).status, 200);
    assert.equal(calls.find((c) => c.text.startsWith("update"))?.values[2], "");
  }),
);

test(
  "PATCH community { description }: moderator, member and outsiders are 403 with no UPDATE; 404, 400, 401 and a lost race are handled",
  withApiEnv(async () => {
    for (const role of ["moderator", "member", null]) {
      const calls = installPool(communityDb(role));
      const res = await communityPatch(patch({ description: "x" }), ctx);
      assert.equal(res.status, 403, String(role));
      assert.ok(!calls.some((c) => c.text.startsWith("update")));
    }
    installPool(communityDb("owner", { missing: true }));
    assert.equal((await communityPatch(patch({ description: "x" }), ctx)).status, 404);

    const calls = installPool(communityDb("owner"));
    assert.equal((await communityPatch(patch({ description: "a".repeat(281) }), ctx)).status, 400);
    assert.equal((await communityPatch(patch({ description: 3 }), ctx)).status, 400);
    assert.equal((await communityPatch(patch({ description: "x", image: null }), ctx)).status, 400);
    assert.equal((await communityPatch(patch({ description: "x" }, false), ctx)).status, 401);
    assert.ok(!calls.some((c) => c.text.startsWith("update")));

    installPool(communityDb("admin", { writeMatches: false }));
    assert.equal((await communityPatch(patch({ description: "x" }), ctx)).status, 403);
  }),
);
