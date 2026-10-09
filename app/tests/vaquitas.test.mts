/**
 * Vaquita (migración 0010): validación de la entrada, quién cierra, reglas para
 * vincular un pago como aporte (cada código de error), progreso, el SQL, la
 * migración y las rutas con un pool falso. Sin red ni base de datos.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";
import { Keypair } from "@stellar/stellar-base";

import { GET as vaquitasGet, POST as vaquitasPost } from "../app/api/communities/[slug]/vaquitas/route.ts";
import { GET as vaquitaGet, PATCH as vaquitaPatch } from "../app/api/vaquitas/[id]/route.ts";
import { POST as contributionPost } from "../app/api/vaquitas/[id]/contributions/route.ts";
import { resetApiLimits } from "../lib/core/api-limits.ts";
import * as q from "../lib/core/db/sql.ts";
import { profileIdFromWallet } from "../lib/core/ids.ts";
import { quotaMessage } from "../lib/core/mappers.ts";
import { SESSION_COOKIE, signSessionCookie } from "../lib/core/session-cookie.ts";
import {
  DEADLINE_MAX_MS,
  canCloseVaquita,
  checkContribution,
  parseGoal,
  parseVaquitaCreate,
  vaquitaProgress,
  type PaymentFactsForVaquita,
  type VaquitaFacts,
} from "../lib/core/vaquita-rules.ts";

const SECRET = randomBytes(24).toString("hex");
const SECRET_BYTES = Buffer.from(SECRET);
const NOW = Date.parse("2026-10-09T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const ALICE = Keypair.random().publicKey(); // la sesión: quien aporta
const BOB = Keypair.random().publicKey(); // quien creó la vaquita
const CAROL = Keypair.random().publicKey();
const aliceId = profileIdFromWallet(ALICE);
const bobId = profileIdFromWallet(BOB);

// ----------------------------------------------------- entrada de crear

test("parseVaquitaCreate: lo mínimo y lo completo", () => {
  const min = parseVaquitaCreate({ title: "  Asado del sábado ", goalUsdc: 50 }, NOW);
  assert.deepEqual(min, { ok: true, value: { title: "Asado del sábado", description: null, goalUsdc: "50.0000000", deadline: null } });

  const full = parseVaquitaCreate(
    { title: "Regalo", description: " Para Ana\ny Luis ", goalUsdc: "12,5", deadline: new Date(NOW + 3 * DAY).toISOString() },
    NOW,
  );
  assert.ok(full.ok);
  assert.equal(full.value.description, "Para Ana\ny Luis");
  assert.equal(full.value.goalUsdc, "12.5000000");
  assert.equal(full.value.deadline, new Date(NOW + 3 * DAY).toISOString());
});

test("parseVaquitaCreate: título de 1 a 60, sin caracteres de control", () => {
  assert.equal(parseVaquitaCreate({ title: "", goalUsdc: 5 }, NOW).ok, false);
  assert.equal(parseVaquitaCreate({ title: "   ", goalUsdc: 5 }, NOW).ok, false);
  assert.equal(parseVaquitaCreate({ title: 7, goalUsdc: 5 }, NOW).ok, false);
  assert.equal(parseVaquitaCreate({ goalUsdc: 5 }, NOW).ok, false);
  assert.equal(parseVaquitaCreate({ title: "a".repeat(60), goalUsdc: 5 }, NOW).ok, true);
  assert.equal(parseVaquitaCreate({ title: "a".repeat(61), goalUsdc: 5 }, NOW).ok, false);
  const ctl = parseVaquitaCreate({ title: "Uno\u0000\ndos\t tres", goalUsdc: 5 }, NOW);
  assert.ok(ctl.ok);
  assert.equal(ctl.value.title, "Uno dos tres");
});

test("parseVaquitaCreate: descripción hasta 280; vacía = sin descripción", () => {
  const empty = parseVaquitaCreate({ title: "x", description: "  ", goalUsdc: 5 }, NOW);
  assert.ok(empty.ok && empty.value.description === null);
  assert.equal(parseVaquitaCreate({ title: "x", description: "d".repeat(280), goalUsdc: 5 }, NOW).ok, true);
  assert.equal(parseVaquitaCreate({ title: "x", description: "d".repeat(281), goalUsdc: 5 }, NOW).ok, false);
  assert.equal(parseVaquitaCreate({ title: "x", description: 5, goalUsdc: 5 }, NOW).ok, false);
});

test("parseVaquitaCreate: la meta va de 0,01 a 100000 USDC, con hasta 7 decimales", () => {
  for (const bad of [0, -1, 0.001, 100000.01, 100001, "abc", "", "1e3", NaN, Infinity, null, undefined, {}, "1.12345678"]) {
    assert.equal(parseVaquitaCreate({ title: "x", goalUsdc: bad }, NOW).ok, false, String(bad));
  }
  for (const good of [0.01, 1, 100000, "100000", "0.0100000", "99999.9999999"]) {
    assert.equal(parseVaquitaCreate({ title: "x", goalUsdc: good }, NOW).ok, true, String(good));
  }
  assert.equal(parseGoal(50), "50.0000000");
  assert.equal(parseGoal("0,5"), "0.5000000");
});

test("parseVaquitaCreate: la fecha límite tiene que ser futura y de un año como máximo", () => {
  const at = (ms: number) => new Date(NOW + ms).toISOString();
  assert.equal(parseVaquitaCreate({ title: "x", goalUsdc: 5, deadline: at(-1000) }, NOW).ok, false);
  assert.equal(parseVaquitaCreate({ title: "x", goalUsdc: 5, deadline: at(0) }, NOW).ok, false);
  assert.equal(parseVaquitaCreate({ title: "x", goalUsdc: 5, deadline: at(1000) }, NOW).ok, true);
  assert.equal(parseVaquitaCreate({ title: "x", goalUsdc: 5, deadline: at(DEADLINE_MAX_MS) }, NOW).ok, true);
  assert.equal(parseVaquitaCreate({ title: "x", goalUsdc: 5, deadline: at(DEADLINE_MAX_MS + 1000) }, NOW).ok, false);
  assert.equal(parseVaquitaCreate({ title: "x", goalUsdc: 5, deadline: "mañana" }, NOW).ok, false);
  assert.equal(parseVaquitaCreate({ title: "x", goalUsdc: 5, deadline: 12345 }, NOW).ok, false);
  assert.equal(parseVaquitaCreate({ title: "x", goalUsdc: 5, deadline: null }, NOW).ok, true);
});

test("parseVaquitaCreate: el cuerpo tiene que ser un objeto", () => {
  for (const bad of [null, undefined, "x", 5, [], [{ title: "x" }]]) {
    assert.equal(parseVaquitaCreate(bad, NOW).ok, false);
  }
});

// ------------------------------------------------------------- cerrar

test("canCloseVaquita: quien la creó o owner/admin; nadie más", () => {
  assert.equal(canCloseVaquita("member", bobId, bobId), true);
  assert.equal(canCloseVaquita("member", bobId, aliceId), false);
  assert.equal(canCloseVaquita("moderator", bobId, aliceId), false);
  assert.equal(canCloseVaquita("admin", bobId, aliceId), true);
  assert.equal(canCloseVaquita("owner", bobId, aliceId), true);
  assert.equal(canCloseVaquita(null, bobId, aliceId), false);
  assert.equal(canCloseVaquita(null, bobId, bobId), false);
});

// ------------------------------------------------- vincular un aporte

const vaquita: VaquitaFacts = {
  creatorId: bobId,
  creatorWallet: BOB,
  status: "open",
  deadlineAt: NOW + 2 * DAY,
  createdAt: NOW - DAY,
};
const payment: PaymentFactsForVaquita = {
  fromWallet: ALICE,
  toWallet: BOB,
  asset: "USDC",
  unverified: false,
  paidAt: NOW - 1000,
  linked: false,
};
const session = { profileId: aliceId, wallet: ALICE };

function denied(v: VaquitaFacts, p: PaymentFactsForVaquita, s = session) {
  const d = checkContribution(v, p, s, NOW);
  assert.equal(d.ok, false);
  return d.ok ? null : d;
}

test("checkContribution: un pago correcto cuenta", () => {
  assert.deepEqual(checkContribution(vaquita, payment, session, NOW), { ok: true });
  assert.deepEqual(checkContribution({ ...vaquita, deadlineAt: null }, payment, session, NOW), { ok: true });
});

test("checkContribution: closed (cerrada o con la fecha límite vencida)", () => {
  assert.equal(denied({ ...vaquita, status: "closed" }, payment)?.code, "closed");
  assert.equal(denied({ ...vaquita, deadlineAt: NOW - 1 }, payment)?.code, "closed");
  assert.equal(denied({ ...vaquita, deadlineAt: NOW }, payment)?.code, "closed");
  assert.equal(denied({ ...vaquita, status: "closed" }, payment)?.status, 409);
});

test("checkContribution: payment_mismatch (activo, remitente, destino, fecha)", () => {
  const cases: Array<Partial<PaymentFactsForVaquita>> = [
    { asset: "XLM" },
    { fromWallet: CAROL },
    { toWallet: CAROL },
    { toWallet: ALICE },
    { paidAt: vaquita.createdAt - 1 },
  ];
  for (const change of cases) {
    const d = denied(vaquita, { ...payment, ...change });
    assert.equal(d?.code, "payment_mismatch", JSON.stringify(change));
    assert.equal(d?.status, 422);
  }
  assert.equal(checkContribution(vaquita, { ...payment, paidAt: vaquita.createdAt }, session, NOW).ok, true);
});

test("checkContribution: payment_unverified (no pasó por el PIN)", () => {
  const d = denied(vaquita, { ...payment, unverified: true });
  assert.equal(d?.code, "payment_unverified");
  assert.equal(d?.status, 422);
});

test("checkContribution: already_linked", () => {
  const d = denied(vaquita, { ...payment, linked: true });
  assert.equal(d?.code, "already_linked");
  assert.equal(d?.status, 409);
});

test("checkContribution: quien creó la vaquita no aporta a la suya", () => {
  const d = denied(vaquita, { ...payment, fromWallet: BOB, toWallet: BOB }, { profileId: bobId, wallet: BOB });
  assert.equal(d?.code, "own_vaquita");
  assert.equal(d?.status, 403);
});

// ------------------------------------------------------------- progreso

test("vaquitaProgress: porcentaje hacia abajo, meta alcanzada y lo que falta", () => {
  assert.deepEqual(vaquitaProgress("50.0000000", "0"), { percent: 0, reached: false, remainingUsdc: "50.0000000" });
  assert.deepEqual(vaquitaProgress("50.0000000", "20.0000000"), { percent: 40, reached: false, remainingUsdc: "30.0000000" });
  assert.deepEqual(vaquitaProgress("50.0000000", "49.9999999"), { percent: 99, reached: false, remainingUsdc: "0.0000001" });
  assert.deepEqual(vaquitaProgress("50.0000000", "50.0000000"), { percent: 100, reached: true, remainingUsdc: "0.0000000" });
  assert.deepEqual(vaquitaProgress("50.0000000", "80.5000000"), { percent: 100, reached: true, remainingUsdc: "0.0000000" });
  assert.deepEqual(vaquitaProgress("0.0100000", "0.0033333"), { percent: 33, reached: false, remainingUsdc: "0.0066667" });
  assert.equal(vaquitaProgress("basura", "1").percent, 0);
});

// ------------------------------------------------------------------ SQL

const HOSTILE = ["x'; drop table vaquitas; --", "1 or 1=1", "$1; select pg_sleep(10)"];

test("SQL de vaquitas: parametrizado, la entrada nunca va en el texto", () => {
  for (const evil of HOSTILE) {
    const queries = [
      q.insertVaquita({ communityId: evil, creatorId: evil, title: evil, description: evil, goalUsdc: evil, deadline: evil }),
      q.vaquitaById(evil),
      q.listVaquitas(evil, 100),
      q.vaquitaWithRole(evil, evil),
      q.listVaquitaContributions(evil, 200),
      q.paymentForVaquita(evil),
      q.insertVaquitaContribution(evil, evil, evil, evil),
      q.closeVaquita(evil, evil),
    ];
    for (const query of queries) {
      assert.ok(!query.text.includes(evil), query.text);
      assert.ok(query.values.includes(evil));
      assert.ok(!/\$\d+;/.test(query.text));
    }
  }
});

test("SQL de vaquitas: lo recaudado y los aportantes se calculan, no se leen de una columna", () => {
  const one = q.vaquitaById("id").text;
  assert.match(one, /sum\(c\.amount_usdc\)/);
  assert.match(one, /count\(distinct c\.contributor_id\)/);
  assert.match(one, /agg\.raised::text as raised_usdc/);
  assert.match(one, /a\.wallet as creator_wallet/);
  assert.match(q.listVaquitas("c", 100).text, /order by \(v\.status = 'open'\) desc, coalesce\(v\.closed_at, v\.created_at\) desc/);
});

test("SQL de vincular: aplica las reglas dentro del INSERT", () => {
  const { text, values } = q.insertVaquitaContribution("v", "p", "me", ALICE);
  assert.deepEqual(values, ["v", "p", "me", ALICE]);
  for (const fragment of [
    "v.status = 'open'",
    "v.deadline is null or v.deadline > now()",
    "v.creator_id <> $3::uuid",
    "py.asset = 'USDC'",
    "py.from_wallet = $4",
    "py.to_wallet = cr.wallet",
    "not py.unverified",
    "py.paid_at >= v.created_at",
    "from public.members m where m.community_id = v.community_id and m.profile_id = $3::uuid",
  ]) {
    assert.ok(text.includes(fragment), fragment);
  }
  // El monto y quien aporta salen del pago y de la sesión, no de un valor suelto.
  assert.match(text, /select v\.id, py\.id, \$3::uuid, py\.amount/);
});

test("SQL de cerrar y de crear: el permiso y la membresía van dentro de la sentencia", () => {
  const close = q.closeVaquita("v", "me").text;
  assert.match(close, /v\.status = 'open'/);
  assert.match(close, /v\.creator_id = \$2/);
  assert.match(close, /m\.role in \('owner', 'admin'\)/);
  const insert = q.insertVaquita({ communityId: "c", creatorId: "me", title: "t", description: null, goalUsdc: "1", deadline: null }).text;
  assert.match(insert, /where exists \(select 1 from public\.members m where m\.community_id = \$1::uuid and m\.profile_id = \$2::uuid\)/);
});

test("vaquitaStats: creadas, aportes y completadas (recaudado >= meta)", () => {
  const { text, values } = q.vaquitaStats();
  assert.deepEqual(values, []);
  for (const alias of ["created", "open", "creators", "contributions", "contributors", "raised_usdc", "completed"]) {
    assert.match(text, new RegExp(`as ${alias}\\b`), alias);
  }
  assert.match(text, />= v\.goal_usdc/);
});

test("las cuotas de la migración tienen mensaje en español", () => {
  assert.match(quotaMessage({ message: "quota_exceeded:vaquitas_open_per_community" }) ?? "", /20 vaquitas abiertas/);
  assert.match(quotaMessage({ message: "quota_exceeded:vaquitas_per_hour" }) ?? "", /vaquitas/);
});

// ------------------------------------------------------------- migración

const migration = readFileSync(new URL("../db/migrations/0010_vaquitas.sql", import.meta.url), "utf8");

test("migración 0010: tablas, límites, índice y unicidad del pago", () => {
  assert.match(migration, /create table if not exists public\.vaquitas/);
  assert.match(migration, /create table if not exists public\.vaquita_contributions/);
  assert.match(migration, /community_id uuid not null references public\.communities \(id\) on delete cascade/);
  assert.match(migration, /creator_id\s+uuid not null references public\.profiles \(id\)/);
  assert.match(migration, /goal_usdc\s+numeric\(20, 7\) not null/);
  assert.match(migration, /char_length\(title\) between 1 and 60/);
  assert.match(migration, /char_length\(description\) between 1 and 280/);
  assert.match(migration, /goal_usdc > 0 and goal_usdc <= 100000/);
  assert.match(migration, /status in \('open', 'closed'\)/);
  assert.match(migration, /on public\.vaquitas \(community_id, created_at desc\)/);
  assert.match(migration, /vaquita_id\s+uuid not null references public\.vaquitas \(id\) on delete cascade/);
  assert.match(migration, /payment_id\s+uuid not null references public\.payments \(id\)/);
  assert.match(migration, /unique \(payment_id\)/);
  assert.match(migration, /amount_usdc > 0/);
  // Lo recaudado y los aportantes no se guardan.
  assert.doesNotMatch(migration, /raised|contributors_count/i);
});

test("migración 0010: cuotas por trigger (20 abiertas por comunidad, 10 por hora)", () => {
  assert.match(migration, /create trigger vaquitas_before_insert_quota\s+before insert on public\.vaquitas/);
  assert.match(migration, /v_open >= 20/);
  assert.match(migration, /quota_exceeded:vaquitas_open_per_community/);
  assert.match(migration, /v_hour >= 10/);
  assert.match(migration, /quota_exceeded:vaquitas_per_hour/);
  assert.match(migration, /pg_advisory_xact_lock/);
});

test("migración 0010: idempotente (se puede volver a correr)", () => {
  assert.doesNotMatch(migration, /^create table (?!if not exists)/im);
  assert.doesNotMatch(migration, /^create index (?!if not exists)/im);
  assert.match(migration, /drop trigger if exists vaquitas_before_insert_quota/);
  const adds = migration.match(/add constraint (\w+)/g) ?? [];
  const drops = migration.match(/drop constraint if exists (\w+)/g) ?? [];
  assert.equal(adds.length, drops.length);
  assert.match(migration, /create or replace function/);
  assert.doesNotMatch(migration, /\bdrop table\b/i);
});

// ------------------------------------------------------ rutas (pool falso)

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

const cookie = () => `${SESSION_COOKIE}=${signSessionCookie({ secret: SECRET_BYTES, wallet: ALICE, now: Date.now() }).token}`;

function req(path: string, method: string, body?: unknown, withCookie = true): Request {
  const headers: Record<string, string> = {};
  if (withCookie) headers.cookie = cookie();
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://kosmovia.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const COMMUNITY_ID = "11111111-1111-4111-8111-111111111111";
const VAQUITA_ID = "22222222-2222-4222-8222-222222222222";
const PAYMENT_ID = "33333333-3333-4333-8333-333333333333";
const CONTRIBUTION_ID = "44444444-4444-4444-8444-444444444444";

const slugCtx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

const author = (id: string, username: string) => ({ id, username, display_name: username, avatar_seed: null, avatar_style: null });
const wireVaquita = (over: Record<string, unknown> = {}) => ({
  id: VAQUITA_ID,
  community_id: COMMUNITY_ID,
  title: "Asado del sábado",
  description: null,
  goal_usdc: "50.0000000",
  raised_usdc: "20.0000000",
  contributors_count: 2,
  deadline: null,
  status: "open",
  created_at: "2026-10-09T10:00:00.000000Z",
  closed_at: null,
  creator_wallet: BOB,
  creator: author(bobId, "bob"),
  ...over,
});

interface World {
  /** Rol de la sesión en la comunidad (null = no es miembro). */
  role?: string | null;
  vaquita?: Record<string, unknown> | null;
  payment?: Record<string, unknown> | null;
  insertThrows?: string;
  insertReturnsNothing?: boolean;
}

function world(w: World = {}): Call[] {
  const role = w.role === undefined ? "member" : w.role;
  const access = w.vaquita === null ? null : {
    id: VAQUITA_ID, community_id: COMMUNITY_ID, creator_id: bobId, status: "open", deadline: null,
    created_at: "2026-10-09T10:00:00.000000Z", creator_wallet: BOB, role, ...w.vaquita,
  };
  const payment = w.payment === null ? null : {
    id: PAYMENT_ID, from_wallet: ALICE, to_wallet: BOB, asset: "USDC", unverified: false,
    paid_at: "2026-10-09T11:00:00.000000Z", linked: false, ...w.payment,
  };
  return installPool((text) => {
    if (text.includes("from public.communities c where c.slug")) return [{ id: COMMUNITY_ID, slug: "kosmo", name: "Kosmo", owner_id: bobId }];
    if (text.startsWith("select role from public.members")) return role === null ? [] : [{ role }];
    if (text.includes("a.wallet as creator_wallet, m.role")) return access ? [access] : [];
    if (text.includes("from public.payments py where py.id")) return payment ? [payment] : [];
    if (text.startsWith("insert into public.vaquita_contributions")) {
      if (w.insertThrows) throw Object.assign(new Error("duplicate"), { code: w.insertThrows });
      return w.insertReturnsNothing ? [] : [{ id: CONTRIBUTION_ID }];
    }
    if (text.startsWith("insert into public.vaquitas")) return [{ id: VAQUITA_ID }];
    if (text.startsWith("update public.vaquitas")) return [{ id: VAQUITA_ID }];
    if (text.includes("agg.raised::text as raised_usdc")) return [wireVaquita()];
    if (text.includes("from public.vaquita_contributions c join public.payments py")) {
      return [{ id: CONTRIBUTION_ID, amount_usdc: "5.0000000", tx_hash: "a".repeat(64), created_at: "2026-10-09T11:00:00.000000Z", contributor: author(aliceId, "alice") }];
    }
    return [];
  });
}

const queryOf = (calls: Call[], fragment: string) => calls.find((c) => c.text.includes(fragment));

test(
  "GET /api/communities/[slug]/vaquitas: pide sesión y solo miembros",
  withApiEnv(async () => {
    world();
    assert.equal((await vaquitasGet(req("/x", "GET", undefined, false), slugCtx("kosmo"))).status, 401);

    world({ role: null });
    const outsider = await vaquitasGet(req("/x", "GET"), slugCtx("kosmo"));
    assert.equal(outsider.status, 403);
    assert.equal(((await outsider.json()) as { code: string }).code, "not_member");

    const calls = world();
    const ok = await vaquitasGet(req("/x", "GET"), slugCtx("kosmo"));
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { vaquitas: Array<{ goal_usdc: string }> };
    assert.equal(body.vaquitas[0].goal_usdc, "50.0000000");
    assert.deepEqual(queryOf(calls, "from public.vaquitas v")?.values, [COMMUNITY_ID, 100]);

    assert.equal((await vaquitasGet(req("/x", "GET"), slugCtx("Mala Slug!"))).status, 404);
  }),
);

test(
  "POST /api/communities/[slug]/vaquitas: crea (201), valida y respeta membresía",
  withApiEnv(async () => {
    const calls = world();
    const ok = await vaquitasPost(req("/x", "POST", { title: "Asado", goalUsdc: 50, deadline: new Date(Date.now() + 3 * DAY).toISOString() }), slugCtx("kosmo"));
    assert.equal(ok.status, 201);
    assert.equal(((await ok.json()) as { vaquita: { id: string } }).vaquita.id, VAQUITA_ID);
    // El creador es la sesión, no el cuerpo.
    const insert = queryOf(calls, "insert into public.vaquitas");
    assert.deepEqual(insert?.values.slice(0, 5), [COMMUNITY_ID, aliceId, "Asado", null, "50.0000000"]);

    const bad = await vaquitasPost(req("/x", "POST", { title: "", goalUsdc: 50 }), slugCtx("kosmo"));
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as { code: string }).code, "invalid_input");
    assert.equal((await vaquitasPost(req("/x", "POST", { title: "x", goalUsdc: 0 }), slugCtx("kosmo"))).status, 400);
    assert.equal((await vaquitasPost(req("/x", "POST", { title: "x", goalUsdc: 5, deadline: "2020-01-01T00:00:00Z" }), slugCtx("kosmo"))).status, 400);

    world({ role: null });
    assert.equal((await vaquitasPost(req("/x", "POST", { title: "x", goalUsdc: 5 }), slugCtx("kosmo"))).status, 403);
    assert.equal((await vaquitasPost(req("/x", "POST", { title: "x", goalUsdc: 5 }, false), slugCtx("kosmo"))).status, 401);
  }),
);

test(
  "POST /api/communities/[slug]/vaquitas: las cuotas del trigger responden 429",
  withApiEnv(async () => {
    installPool((text) => {
      if (text.includes("from public.communities c where c.slug")) return [{ id: COMMUNITY_ID }];
      if (text.startsWith("select role from public.members")) return [{ role: "member" }];
      if (text.startsWith("insert into public.vaquitas")) {
        throw Object.assign(new Error("quota_exceeded:vaquitas_open_per_community"), { code: "P0001" });
      }
      return [];
    });
    const res = await vaquitasPost(req("/x", "POST", { title: "x", goalUsdc: 5 }), slugCtx("kosmo"));
    assert.equal(res.status, 429);
    assert.equal(((await res.json()) as { code: string }).code, "quota_exceeded");
  }),
);

test(
  "GET /api/vaquitas/[id]: miembros de su comunidad; 404 si no existe",
  withApiEnv(async () => {
    world();
    const ok = await vaquitaGet(req("/x", "GET"), idCtx(VAQUITA_ID));
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { vaquita: { raised_usdc: string }; contributions: Array<{ amount_usdc: string }> };
    assert.equal(body.vaquita.raised_usdc, "20.0000000");
    assert.equal(body.contributions[0].amount_usdc, "5.0000000");

    world({ role: null });
    const outsider = await vaquitaGet(req("/x", "GET"), idCtx(VAQUITA_ID));
    assert.equal(outsider.status, 403);
    assert.equal(((await outsider.json()) as { code: string }).code, "not_member");

    world({ vaquita: null });
    assert.equal((await vaquitaGet(req("/x", "GET"), idCtx(VAQUITA_ID))).status, 404);
    const calls = world();
    assert.equal((await vaquitaGet(req("/x", "GET"), idCtx("no-es-uuid"))).status, 404);
    assert.equal(calls.length, 0, "un id que no es uuid ni toca la base");
  }),
);

async function contribute(body: unknown = { paymentId: PAYMENT_ID }) {
  return contributionPost(req("/x", "POST", body), idCtx(VAQUITA_ID));
}
const codeOf = async (res: Response) => ((await res.json()) as { code: string }).code;

test(
  "POST /api/vaquitas/[id]/contributions: un pago correcto se vincula (201)",
  withApiEnv(async () => {
    const calls = world();
    const res = await contribute();
    assert.equal(res.status, 201);
    const body = (await res.json()) as { vaquita: { id: string }; contribution: { id: string; amount_usdc: string } };
    assert.equal(body.vaquita.id, VAQUITA_ID);
    assert.equal(body.contribution.id, CONTRIBUTION_ID);
    // Quien aporta y su wallet salen de la sesión.
    assert.deepEqual(queryOf(calls, "insert into public.vaquita_contributions")?.values, [VAQUITA_ID, PAYMENT_ID, aliceId, ALICE]);
  }),
);

test(
  "POST /api/vaquitas/[id]/contributions: cada regla responde con su código",
  withApiEnv(async () => {
    world({ role: null });
    let res = await contribute();
    assert.equal(res.status, 403);
    assert.equal(await codeOf(res), "not_member");

    world({ vaquita: null });
    res = await contribute();
    assert.equal(res.status, 404);
    assert.equal(await codeOf(res), "not_found");

    world({ payment: null });
    res = await contribute();
    assert.equal(res.status, 404);
    assert.equal(await codeOf(res), "payment_not_found");

    world({ vaquita: { status: "closed" } });
    res = await contribute();
    assert.equal(res.status, 409);
    assert.equal(await codeOf(res), "closed");

    world({ vaquita: { deadline: "2020-01-01T00:00:00.000000Z" } });
    res = await contribute();
    assert.equal(res.status, 409);
    assert.equal(await codeOf(res), "closed");

    for (const payment of [{ asset: "XLM" }, { from_wallet: CAROL }, { to_wallet: CAROL }, { paid_at: "2026-10-09T09:00:00.000000Z" }]) {
      world({ payment });
      res = await contribute();
      assert.equal(res.status, 422, JSON.stringify(payment));
      assert.equal(await codeOf(res), "payment_mismatch");
    }

    world({ payment: { unverified: true } });
    res = await contribute();
    assert.equal(res.status, 422);
    assert.equal(await codeOf(res), "payment_unverified");

    world({ payment: { linked: true } });
    res = await contribute();
    assert.equal(res.status, 409);
    assert.equal(await codeOf(res), "already_linked");

    world({ vaquita: { creator_id: aliceId } });
    res = await contribute();
    assert.equal(res.status, 403);
    assert.equal(await codeOf(res), "own_vaquita");
  }),
);

test(
  "POST /api/vaquitas/[id]/contributions: las carreras (índice único, cierre) también tienen código",
  withApiEnv(async () => {
    world({ insertThrows: "23505" });
    let res = await contribute();
    assert.equal(res.status, 409);
    assert.equal(await codeOf(res), "already_linked");

    world({ insertReturnsNothing: true });
    res = await contribute();
    assert.equal(res.status, 409);
    assert.equal(await codeOf(res), "closed");
  }),
);

test(
  "POST /api/vaquitas/[id]/contributions: el pedido tiene que traer un paymentId válido y sesión",
  withApiEnv(async () => {
    const calls = world();
    for (const body of [{}, { paymentId: 5 }, { paymentId: "no-uuid" }, { paymentId: "" }]) {
      assert.equal((await contribute(body)).status, 400);
    }
    assert.equal(calls.length, 0);
    assert.equal((await contributionPost(req("/x", "POST", { paymentId: PAYMENT_ID }, false), idCtx(VAQUITA_ID))).status, 401);
  }),
);

test(
  "PATCH /api/vaquitas/[id]: cierra quien la creó u owner/admin; los demás no",
  withApiEnv(async () => {
    const patch = (body: unknown = { status: "closed" }) => vaquitaPatch(req("/x", "PATCH", body), idCtx(VAQUITA_ID));

    // Quien la creó.
    let calls = world({ vaquita: { creator_id: aliceId } });
    let res = await patch();
    assert.equal(res.status, 200);
    assert.ok(queryOf(calls, "update public.vaquitas"));

    // Admin de la comunidad.
    calls = world({ role: "admin" });
    assert.equal((await patch()).status, 200);
    assert.ok(queryOf(calls, "update public.vaquitas"));

    // Un miembro cualquiera.
    calls = world({ role: "member" });
    res = await patch();
    assert.equal(res.status, 403);
    assert.equal(await codeOf(res), "forbidden");
    assert.equal(queryOf(calls, "update public.vaquitas"), undefined);

    // Ajeno a la comunidad.
    world({ role: null });
    assert.equal((await patch()).status, 403);

    // Ya cerrada: se devuelve tal cual, sin escribir.
    calls = world({ role: "member", vaquita: { status: "closed" } });
    assert.equal((await patch()).status, 200);
    assert.equal(queryOf(calls, "update public.vaquitas"), undefined);

    // Solo se acepta cerrar.
    world();
    for (const body of [{ status: "open" }, {}, { title: "x" }, null]) {
      assert.equal((await patch(body)).status, 400);
    }
  }),
);
