/**
 * PIN de pagos (migración 0009): reglas puras, hash con pepper, bloqueo
 * progresivo, límites, cuándo un permiso respalda un pago, el SQL, la migración
 * y las rutas /api/security/* y POST /api/payments con un pool falso. Sin red
 * ni base de datos.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";
import { Keypair } from "@stellar/stellar-base";

import { GET as securityGet } from "../app/api/security/route.ts";
import { PUT as pinPut } from "../app/api/security/pin/route.ts";
import { POST as pinReset } from "../app/api/security/pin/reset/route.ts";
import { PUT as limitsPut } from "../app/api/security/limits/route.ts";
import { POST as approvePost } from "../app/api/security/approve/route.ts";
import { POST as paymentsPost, GET as paymentsGet } from "../app/api/payments/route.ts";
import { resetApiLimits } from "../lib/core/api-limits.ts";
import * as q from "../lib/core/db/sql.ts";
import { profileIdFromWallet } from "../lib/core/ids.ts";
import { USDC_ISSUER_TESTNET } from "../lib/core/pollar-config.ts";
import {
  APPROVAL_GRACE_MS,
  APPROVAL_TTL_MS,
  LOCK_MAX_MS,
  MAX_FAILED_ATTEMPTS,
  PIN_HASH_VERSION,
  approvalMatches,
  attemptsLeft,
  hashPin,
  isLocked,
  isTrivialPin,
  limitDecision,
  lockDurationMs,
  nextFailureState,
  parseDailyLimit,
  pepperKey,
  sessionIsFresh,
  stateAfterSuccess,
  validatePin,
  verifyPinHash,
  type ApprovalFacts,
  type FailureState,
} from "../lib/core/pin.ts";
import { SESSION_COOKIE, signSessionCookie } from "../lib/core/session-cookie.ts";

const SECRET = randomBytes(24).toString("hex");
const SECRET_BYTES = Buffer.from(SECRET);
const GOOD_PIN = "482916";

// ------------------------------------------------------------ validar el PIN

test("validatePin: acepta 6 dígitos que no son triviales", () => {
  for (const pin of ["482916", "070315", "951203", "100000", "135790", "246810"]) {
    assert.deepEqual(validatePin(pin), { ok: true, pin }, pin);
  }
});

test("validatePin: exactamente 6 dígitos ASCII (invalid_pin)", () => {
  const bad: unknown[] = [
    "", "12345", "1234567", "48291a", " 482916", "482916 ", "48 2916", "48-916", "+48291", "4.2916",
    "٤٨٢٩١٦", // dígitos arábigo-índicos
    "４８２９１６", // dígitos de ancho completo
    "482916\n", "482916\u0000",
    482916, null, undefined, {}, ["482916"], true,
  ];
  for (const pin of bad) {
    const check = validatePin(pin);
    assert.ok(!check.ok && check.code === "invalid_pin", `${JSON.stringify(pin)}`);
  }
});

test("validatePin: rechaza los PIN triviales (weak_pin)", () => {
  const trivial = [
    "000000", "111111", "999999", // todos iguales
    "123456", "234567", "345678", "456789", "012345", // ascendentes
    "654321", "987654", "876543", "543210", // descendentes
    "121212", "696969", "909090", // ababab
    "112233", "445566", "001122", // aabbcc
    "123123", "482482", // abcabc
    "123321", "489984", // abccba
  ];
  for (const pin of trivial) {
    const check = validatePin(pin);
    assert.ok(!check.ok && check.code === "weak_pin", pin);
    assert.ok(isTrivialPin(pin), pin);
  }
  // Casi trivial pero no: pasa.
  for (const pin of ["123457", "121213", "112234", "123124"]) assert.ok(validatePin(pin).ok, pin);
});

// ------------------------------------------------------ hash con sal y pepper

test("hashPin: formato versionado, sal por persona y verificación", async () => {
  const a = await hashPin(GOOD_PIN, SECRET_BYTES);
  const b = await hashPin(GOOD_PIN, SECRET_BYTES);
  assert.match(a.hash, new RegExp(`^${PIN_HASH_VERSION}\\$[A-Za-z0-9_-]{43}$`)); // 32 bytes en base64url
  assert.equal(Buffer.from(a.salt, "base64url").length, 16);
  assert.notEqual(a.salt, b.salt, "cada hash lleva su propia sal");
  assert.notEqual(a.hash, b.hash, "el mismo PIN con otra sal da otro hash");
  assert.ok(!a.hash.includes(GOOD_PIN) && !a.salt.includes(GOOD_PIN));
  assert.equal(await verifyPinHash(GOOD_PIN, SECRET_BYTES, a), true);
  assert.equal(await verifyPinHash("482917", SECRET_BYTES, a), false);
  assert.equal(await verifyPinHash("", SECRET_BYTES, a), false);
});

test("pepper: con otro SESSION_SECRET el mismo hash y sal no verifican", async () => {
  const salt = randomBytes(16);
  const a = await hashPin(GOOD_PIN, SECRET_BYTES, salt);
  const otherSecret = Buffer.from(randomBytes(24).toString("hex"));
  const b = await hashPin(GOOD_PIN, otherSecret, salt);
  assert.notEqual(a.hash, b.hash, "sin el secreto no se puede recalcular el hash");
  assert.equal(await verifyPinHash(GOOD_PIN, otherSecret, a), false);
  assert.equal(await verifyPinHash(GOOD_PIN, SECRET_BYTES, a), true);
  assert.notDeepEqual(pepperKey(SECRET_BYTES), pepperKey(otherSecret));
  assert.equal(pepperKey(SECRET_BYTES).length, 32);
  assert.throws(() => pepperKey(Buffer.from("corto")), /too short/);
  await assert.rejects(hashPin(GOOD_PIN, Buffer.from("corto")), /too short/);
});

test("verifyPinHash: un formato desconocido o alterado es simplemente 'no'", async () => {
  const stored = await hashPin(GOOD_PIN, SECRET_BYTES);
  const body = stored.hash.split("$")[1];
  for (const hash of ["v2$" + body, body, "v1$", "v1$" + body + "$x", "v1$" + body.slice(1), ""]) {
    assert.equal(await verifyPinHash(GOOD_PIN, SECRET_BYTES, { hash, salt: stored.salt }), false, hash);
  }
  for (const salt of ["", "AAAA", stored.salt.slice(1)]) {
    assert.equal(await verifyPinHash(GOOD_PIN, SECRET_BYTES, { hash: stored.hash, salt }), false, salt);
  }
});

// ---------------------------------------------------------------- bloqueo

test("lockDurationMs: 15 min * 2^nivel con tope de 24 h", () => {
  const min = 60 * 1000;
  assert.equal(lockDurationMs(0), 15 * min);
  assert.equal(lockDurationMs(1), 30 * min);
  assert.equal(lockDurationMs(2), 60 * min);
  assert.equal(lockDurationMs(3), 120 * min);
  assert.equal(lockDurationMs(6), 960 * min); // 16 h
  assert.equal(lockDurationMs(7), LOCK_MAX_MS); // 32 h -> tope
  assert.equal(lockDurationMs(30), LOCK_MAX_MS);
  assert.equal(lockDurationMs(1000), LOCK_MAX_MS);
  assert.equal(LOCK_MAX_MS, 24 * 60 * min);
});

test("bloqueo progresivo: 5 fallos bloquean, el nivel sube y un acierto lo limpia", () => {
  const t0 = 1_000_000_000_000;
  let state: FailureState = { failedAttempts: 0, lockLevel: 0 };
  for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
    const next = nextFailureState(state, t0);
    assert.equal(next.lockedUntil, null);
    assert.equal(next.failedAttempts, i);
    assert.equal(attemptsLeft(next.failedAttempts), MAX_FAILED_ATTEMPTS - i);
    state = next;
  }
  const first = nextFailureState(state, t0); // el 5.º fallo
  assert.deepEqual(first, { failedAttempts: 0, lockLevel: 1, lockedUntil: t0 + 15 * 60_000 });
  assert.ok(isLocked(first.lockedUntil, t0 + 1));
  assert.ok(!isLocked(first.lockedUntil, first.lockedUntil as number));

  // Segundo bloqueo seguido: el doble. Y así hasta el tope de 24 h.
  let lockState: FailureState = { failedAttempts: first.failedAttempts, lockLevel: first.lockLevel };
  let expectedLevel = 1;
  for (let round = 0; round < 12; round++) {
    let last = nextFailureState(lockState, t0);
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) last = nextFailureState(last, t0);
    assert.equal(last.lockedUntil, t0 + Math.min(15 * 60_000 * 2 ** expectedLevel, LOCK_MAX_MS));
    expectedLevel = Math.min(expectedLevel + 1, 30);
    assert.equal(last.lockLevel, expectedLevel);
    lockState = { failedAttempts: last.failedAttempts, lockLevel: last.lockLevel };
  }
  assert.ok(lockDurationMs(lockState.lockLevel) <= LOCK_MAX_MS);

  assert.deepEqual(stateAfterSuccess(), { failedAttempts: 0, lockLevel: 0, lockedUntil: null });
});

// --------------------------------------------------------------- límites

test("parseDailyLimit: > 0, tope de 100000 y hasta 7 decimales", () => {
  assert.deepEqual(parseDailyLimit(250), { ok: true, amount: "250.0000000" });
  assert.deepEqual(parseDailyLimit("0,5"), { ok: true, amount: "0.5000000" });
  assert.deepEqual(parseDailyLimit(0.1 + 0.2), { ok: true, amount: "0.3000000" });
  assert.deepEqual(parseDailyLimit(100000), { ok: true, amount: "100000.0000000" });
  for (const bad of [0, -1, "0", "abc", "", "1e3", 100000.01, 1e12, Infinity, NaN, null, undefined, {}, "1.12345678"]) {
    assert.ok(!parseDailyLimit(bad).ok, String(bad));
  }
});

test("limitDecision: suma en stroops y dice cuánto queda", () => {
  assert.deepEqual(limitDecision("100.0000000", "60.0000000", "40.0000000"), { ok: true });
  assert.deepEqual(limitDecision("100.0000000", "60.0000000", "40.0000001"), { ok: false, remaining: 40 });
  assert.deepEqual(limitDecision("100", "100", "0.01"), { ok: false, remaining: 0 });
  assert.deepEqual(limitDecision("100", "130", "1"), { ok: false, remaining: 0 }, "gastado > límite: nada queda");
  assert.deepEqual(limitDecision("0.3000000", "0.1000000", "0.2000000"), { ok: true }, "sin errores de flotante");
});

// --------------------------------------------------------------- permisos

const T0 = Date.parse("2026-10-09T12:00:00Z");
const ALICE = Keypair.random().publicKey();
const BOB = Keypair.random().publicKey();
const CAROL = Keypair.random().publicKey();
const aliceId = profileIdFromWallet(ALICE);
const approvalOk: ApprovalFacts = {
  profileId: aliceId,
  toWallet: BOB,
  asset: "USDC",
  amount: "5.0000000",
  createdAt: T0,
  expiresAt: T0 + APPROVAL_TTL_MS,
  usedAt: null,
};
const paymentOk = { profileId: aliceId, toWallet: BOB, asset: "USDC", amount: "5", paidAt: T0 + 20_000 };

test("approvalMatches: mismo perfil, destino, activo, monto exacto, sin usar y a tiempo", () => {
  assert.equal(approvalMatches(approvalOk, paymentOk), true);
  assert.equal(approvalMatches(approvalOk, { ...paymentOk, amount: "5.0000000" }), true, "5 = 5.0000000");
  assert.equal(APPROVAL_TTL_MS, 2 * 60 * 1000);
});

test("approvalMatches: monto distinto, otro destino, otro activo u otro perfil -> unverified", () => {
  assert.equal(approvalMatches(approvalOk, { ...paymentOk, amount: "5.0000001" }), false);
  assert.equal(approvalMatches(approvalOk, { ...paymentOk, amount: "4.9999999" }), false);
  assert.equal(approvalMatches(approvalOk, { ...paymentOk, amount: "50" }), false);
  assert.equal(approvalMatches(approvalOk, { ...paymentOk, toWallet: CAROL }), false);
  assert.equal(approvalMatches(approvalOk, { ...paymentOk, asset: "XLM" }), false);
  assert.equal(approvalMatches(approvalOk, { ...paymentOk, profileId: profileIdFromWallet(BOB) }), false);
  assert.equal(approvalMatches({ ...approvalOk, amount: "x" }, paymentOk), false);
});

test("approvalMatches: usado, vencido o anterior al permiso -> unverified", () => {
  assert.equal(approvalMatches({ ...approvalOk, usedAt: T0 + 5_000 }, paymentOk), false, "un permiso se usa una sola vez");
  // Vencido: el pago cerró más de 60 s después de que venció.
  const expiry = approvalOk.expiresAt;
  assert.equal(approvalMatches(approvalOk, { ...paymentOk, paidAt: expiry + APPROVAL_GRACE_MS }), true, "justo en la holgura");
  assert.equal(approvalMatches(approvalOk, { ...paymentOk, paidAt: expiry + APPROVAL_GRACE_MS + 1 }), false);
  assert.equal(approvalMatches(approvalOk, { ...paymentOk, paidAt: expiry + 10 * 60_000 }), false);
  // Un pago anterior al permiso no lo puede usar.
  assert.equal(approvalMatches(approvalOk, { ...paymentOk, paidAt: T0 - APPROVAL_GRACE_MS }), true);
  assert.equal(approvalMatches(approvalOk, { ...paymentOk, paidAt: T0 - APPROVAL_GRACE_MS - 1 }), false);
});

test("sessionIsFresh: la sesión tiene que ser de hace menos de 10 minutos", () => {
  assert.equal(sessionIsFresh(T0 - 9 * 60_000, T0), true);
  assert.equal(sessionIsFresh(T0 - 10 * 60_000, T0), false);
  assert.equal(sessionIsFresh(T0 - 11 * 60_000, T0), false);
  assert.equal(sessionIsFresh(T0, T0), true);
  assert.equal(sessionIsFresh(T0 + 90_000, T0), false, "un iat del futuro lejano no vale");
  assert.equal(sessionIsFresh(NaN, T0), false);
});

// ---------------------------------------------------------------- SQL

const HOSTILE = "x'; drop table payment_security; --";
const POLICY = { maxAttempts: 5, baseMs: 15 * 60_000, maxMs: LOCK_MAX_MS, maxLevel: 30 };

test("el SQL del PIN va parametrizado (nada del usuario entra al texto)", () => {
  const queries = [
    q.securityRow(HOSTILE),
    q.approvedLast24h(HOSTILE),
    q.reservePinAttempt(HOSTILE, POLICY),
    q.clearPinFailures(HOSTILE),
    q.createPin(HOSTILE, HOSTILE, HOSTILE),
    q.changePin(HOSTILE, HOSTILE, HOSTILE),
    q.resetPin(HOSTILE, HOSTILE, HOSTILE),
    q.invalidatePendingApprovals(HOSTILE),
    q.setDailyLimits(HOSTILE, HOSTILE, null),
    q.lockSecurityRow(HOSTILE),
    q.insertApproval({ profileId: HOSTILE, toWallet: HOSTILE, asset: HOSTILE, amount: HOSTILE, ttlMs: APPROVAL_TTL_MS }),
    q.claimApproval({ approvalId: HOSTILE, profileId: HOSTILE, toWallet: HOSTILE, asset: HOSTILE, amount: HOSTILE, paidAt: HOSTILE, graceMs: 1 }),
    q.linkApproval(HOSTILE, HOSTILE),
    q.releaseApproval(HOSTILE),
  ];
  for (const query of queries) {
    assert.ok(!query.text.includes("drop table"), query.text);
    assert.ok(!query.text.includes(HOSTILE));
    assert.ok(query.values.includes(HOSTILE) || query.values.length > 0);
  }
});

test("reservePinAttempt: un solo UPDATE atómico que cuenta el intento y se niega si hay bloqueo", () => {
  const query = q.reservePinAttempt("p", POLICY);
  assert.match(query.text, /^update public\.payment_security s set /);
  assert.match(query.text, /failed_attempts = case when s\.failed_attempts \+ 1 >= \$2 then 0 else s\.failed_attempts \+ 1 end/);
  assert.match(query.text, /lock_level = case when s\.failed_attempts \+ 1 >= \$2 then least\(s\.lock_level \+ 1, \$5\)/);
  assert.match(query.text, /power\(2, s\.lock_level\)/);
  assert.match(query.text, /where s\.profile_id = \$1 and s\.pin_hash is not null and \(s\.locked_until is null or s\.locked_until <= now\(\)\)/);
  assert.match(query.text, /returning s\.pin_hash, s\.pin_salt/);
  // La política viaja como parámetros: 5 fallos, 15 min, tope 24 h, nivel máximo 30.
  assert.deepEqual(query.values, ["p", 5, 900_000, 86_400_000, 30]);
});

test("claimApproval: perfil, destino, activo, monto exacto, sin usar y dentro de la vida del permiso", () => {
  const query = q.claimApproval({ approvalId: "a", profileId: "p", toWallet: "w", asset: "USDC", amount: "5", paidAt: "2026-10-09T12:00:00Z", graceMs: 60_000 });
  assert.match(query.text, /set used_at = now\(\)/);
  for (const part of [
    "a.id = $1::uuid", "a.profile_id = $2", "a.to_wallet = $3", "a.asset = $4", "a.amount = $5::numeric", "a.used_at is null",
    "$6::timestamptz <= a.expires_at +", "$6::timestamptz >= a.created_at -",
  ]) {
    assert.ok(query.text.includes(part), part);
  }
  assert.equal(query.values.length, 7);
});

test("pagos: el SQL guarda approval_id y unverified, y a quien recibe no se le marca", () => {
  const base = {
    opId: "1", txHash: "a".repeat(64), fromWallet: ALICE, toWallet: BOB, asset: "USDC", amount: "1.0000000",
    note: null, registeredBy: aliceId, paidAt: "2026-10-09T12:00:00Z",
  };
  const without = q.insertPayment(base);
  assert.match(without.text, /approval_id, unverified\) values/);
  assert.deepEqual(without.values.slice(9), [null, true], "sin permiso: unverified");
  const withApproval = q.insertPayment({ ...base, approvalId: "5b9f0ed1-ca61-4f5c-9cc6-5c0a0c94c6aa" });
  assert.deepEqual(withApproval.values.slice(9), ["5b9f0ed1-ca61-4f5c-9cc6-5c0a0c94c6aa", false]);
  const list = q.paymentsOfWallet(ALICE, 50);
  assert.match(list.text, /\(py\.unverified and py\.from_wallet = \$1\) as unverified/);
  assert.match(q.paymentByOpForSender("1", ALICE).text, /py\.unverified as unverified/);
});

test("0009_pin_pagos.sql: tablas, límites, permisos y columnas nuevas de payments", () => {
  const sql = readFileSync(new URL("../db/migrations/0009_pin_pagos.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.payment_security/);
  assert.match(sql, /profile_id\s+uuid primary key references public\.profiles \(id\) on delete cascade/);
  for (const col of [
    /pin_hash\s+text null/, /pin_salt\s+text null/, /pin_set_at\s+timestamptz null/,
    /failed_attempts\s+integer not null default 0/, /lock_level\s+integer not null default 0/, /locked_until\s+timestamptz null/,
    /daily_limit_usdc\s+numeric\(20, 7\) not null default 100,/, /daily_limit_xlm\s+numeric\(20, 7\) not null default 1000,/,
  ]) {
    assert.match(sql, col);
  }
  assert.match(sql, /daily_limit_usdc > 0 and daily_limit_usdc <= 100000/);
  assert.match(sql, /daily_limit_xlm > 0 and daily_limit_xlm <= 100000/);
  assert.match(sql, /create table if not exists public\.payment_approvals/);
  assert.match(sql, /to_wallet ~ '\^G\[A-Z2-7\]\{55\}\$'/);
  assert.match(sql, /asset in \('USDC', 'XLM'\)/);
  assert.match(sql, /amount > 0/);
  assert.match(sql, /method in \('pin', 'passkey'\)/);
  assert.match(sql, /payment_id uuid null references public\.payments \(id\)/);
  assert.match(sql, /create index if not exists payment_approvals_profile_created_idx\s+on public\.payment_approvals \(profile_id, created_at desc\)/);
  assert.match(sql, /alter table public\.payments add column if not exists approval_id uuid null references public\.payment_approvals/);
  assert.match(sql, /alter table public\.payments add column if not exists unverified boolean not null default false/);
  // Idempotente: nada de CREATE sin IF NOT EXISTS ni ADD CONSTRAINT sin su DROP previo.
  assert.ok(!/create table (?!if not exists)/i.test(sql));
  const adds = sql.match(/add constraint (\w+)/g) ?? [];
  for (const add of adds) {
    const name = add.replace("add constraint ", "");
    assert.ok(sql.includes(`drop constraint if exists ${name}`), name);
  }
});

// ------------------------------------------------------- rutas (pool falso)

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

const sessionAt = (now: number) =>
  `${SESSION_COOKIE}=${signSessionCookie({ secret: SECRET_BYTES, wallet: ALICE, now }).token}`;

function req(path: string, method: string, body?: unknown, cookie: string | null = sessionAt(Date.now())): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://kosmovia.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const queryOf = (calls: Call[], fragment: string) => calls.find((c) => c.text.includes(fragment));

test(
  "GET /api/security: pide sesión y devuelve el estado sin hash ni sal",
  withApiEnv(async () => {
    const anon = await securityGet(req("/api/security", "GET", undefined, null));
    assert.equal(anon.status, 401);

    const calls = installPool((text) => {
      if (text.startsWith("select (s.pin_hash is not null) as has_pin")) {
        return [{ has_pin: true, locked_until: null, daily_limit_usdc: "100.0000000", daily_limit_xlm: "1000.0000000" }];
      }
      if (text.includes("from public.payment_approvals a")) return [{ asset: "USDC", spent: "12.5000000" }];
      return [];
    });
    const res = await securityGet(req("/api/security", "GET"));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      hasPin: true,
      lockedUntil: null,
      dailyLimit: { USDC: 100, XLM: 1000 },
      spentToday: { USDC: 12.5, XLM: 0 },
    });
    assert.ok(calls.every((c) => c.values.includes(aliceId)), "siempre el perfil de la sesión");
  }),
);

test(
  "GET /api/security: sin fila = sin PIN y con los límites por defecto",
  withApiEnv(async () => {
    installPool(() => []);
    const body = await (await securityGet(req("/api/security", "GET"))).json();
    assert.deepEqual(body, { hasPin: false, lockedUntil: null, dailyLimit: { USDC: 100, XLM: 1000 }, spentToday: { USDC: 0, XLM: 0 } });
  }),
);

test(
  "PUT /api/security/pin: PIN inválido o débil se rechaza antes de tocar la base",
  withApiEnv(async () => {
    const calls = installPool(() => []);
    for (const [pin, code] of [["12345", "invalid_pin"], ["abcdef", "invalid_pin"], [123456, "invalid_pin"], ["123456", "weak_pin"], ["000000", "weak_pin"]] as const) {
      const res = await pinPut(req("/api/security/pin", "PUT", { pin }));
      assert.equal(res.status, 400, String(pin));
      assert.equal((await res.json()).code, code);
    }
    const res = await pinPut(req("/api/security/pin", "PUT", { pin: GOOD_PIN, currentPin: "abc" }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "invalid_pin");
    assert.equal(calls.length, 0);
  }),
);

test(
  "PUT /api/security/pin: sin PIN previo lo crea (204) y guarda solo hash y sal",
  withApiEnv(async () => {
    const calls = installPool((text) => (text.startsWith("insert into public.payment_security") ? [{ profile_id: aliceId }] : []));
    const res = await pinPut(req("/api/security/pin", "PUT", { pin: GOOD_PIN }));
    assert.equal(res.status, 204);
    const insert = queryOf(calls, "insert into public.payment_security");
    assert.ok(insert);
    assert.match(insert.text, /where s\.pin_hash is null/, "no pisa un PIN que ya existe");
    const [profile, hash, salt] = insert.values as string[];
    assert.equal(profile, aliceId);
    assert.equal(await verifyPinHash(GOOD_PIN, SECRET_BYTES, { hash, salt }), true);
    assert.ok(!JSON.stringify(calls).includes(GOOD_PIN), "el PIN en claro nunca llega a la base");
  }),
);

test(
  "PUT /api/security/pin: con PIN previo exige el actual (409 pin_exists)",
  withApiEnv(async () => {
    const calls = installPool(() => []); // createPin no devuelve fila: ya había PIN
    const res = await pinPut(req("/api/security/pin", "PUT", { pin: "135792" }));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, "pin_exists");
    assert.ok(!calls.some((c) => c.text.startsWith("update public.payment_security s set failed_attempts")), "sin currentPin no se gasta ningún intento");
  }),
);

test(
  "PUT /api/security/pin: cambiar el PIN verifica el actual, lo guarda e invalida los permisos pendientes",
  withApiEnv(async () => {
    const stored = await hashPin(GOOD_PIN, SECRET_BYTES);
    const calls = installPool((text) => {
      if (text.startsWith("insert into public.payment_security")) return [];
      if (text.startsWith("update public.payment_security s set failed_attempts")) {
        return [{ pin_hash: stored.hash, pin_salt: stored.salt, failed_attempts: 1, locked: false, locked_until: null }];
      }
      if (text.startsWith("update public.payment_security set pin_hash")) return [{ profile_id: aliceId }];
      return [];
    });
    const res = await pinPut(req("/api/security/pin", "PUT", { pin: "135792", currentPin: GOOD_PIN }));
    assert.equal(res.status, 204);
    assert.ok(queryOf(calls, "set failed_attempts = 0, lock_level = 0, locked_until = null"), "el acierto limpia los fallos");
    const change = queryOf(calls, "update public.payment_security set pin_hash");
    assert.ok(change);
    assert.equal(await verifyPinHash("135792", SECRET_BYTES, { hash: change.values[1] as string, salt: change.values[2] as string }), true);
    assert.ok(queryOf(calls, "update public.payment_approvals set used_at = now()"), "invalida los permisos pendientes");
  }),
);

test(
  "PUT /api/security/pin: PIN actual incorrecto = 422 wrong_pin con los intentos que quedan (no 401)",
  withApiEnv(async () => {
    const stored = await hashPin(GOOD_PIN, SECRET_BYTES);
    const calls = installPool((text) => {
      if (text.startsWith("insert into public.payment_security")) return [];
      if (text.startsWith("update public.payment_security s set failed_attempts")) {
        return [{ pin_hash: stored.hash, pin_salt: stored.salt, failed_attempts: 3, locked: false, locked_until: null }];
      }
      return [];
    });
    const res = await pinPut(req("/api/security/pin", "PUT", { pin: "135792", currentPin: "999111" }));
    assert.equal(res.status, 422);
    assert.notEqual(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, "wrong_pin");
    assert.equal(body.attemptsLeft, 2);
    assert.ok(!calls.some((c) => c.text.startsWith("update public.payment_security set pin_hash")), "no cambia nada");
  }),
);

test(
  "PUT /api/security/pin: el 5.º fallo bloquea (423 locked con lockedUntil) aunque siga con el PIN equivocado",
  withApiEnv(async () => {
    const stored = await hashPin(GOOD_PIN, SECRET_BYTES);
    const until = "2026-10-09T12:15:00.000000Z";
    installPool((text) => {
      if (text.startsWith("insert into public.payment_security")) return [];
      if (text.startsWith("update public.payment_security s set failed_attempts")) {
        return [{ pin_hash: stored.hash, pin_salt: stored.salt, failed_attempts: 0, locked: true, locked_until: until }];
      }
      return [];
    });
    const res = await pinPut(req("/api/security/pin", "PUT", { pin: "135792", currentPin: "999111" }));
    assert.equal(res.status, 423);
    assert.deepEqual(await res.json(), { error: "Demasiados intentos. Tu PIN está bloqueado por un rato.", code: "locked", lockedUntil: until });
  }),
);

test(
  "bloqueado: el PIN correcto tampoco se verifica (el UPDATE no devuelve fila) -> 423 sin mirar el hash",
  withApiEnv(async () => {
    const until = "2026-10-09T12:15:00.000000Z";
    const calls = installPool((text) => {
      if (text.startsWith("select (s.pin_hash is not null) as has_pin")) {
        return [{ has_pin: true, locked_until: until, daily_limit_usdc: "100", daily_limit_xlm: "1000" }];
      }
      return []; // reservePinAttempt: nada que reservar porque hay bloqueo vigente
    });
    const res = await limitsPut(req("/api/security/limits", "PUT", { USDC: 50, pin: GOOD_PIN }));
    assert.equal(res.status, 423);
    assert.equal((await res.json()).lockedUntil, until);
    assert.ok(!calls.some((c) => c.text.startsWith("update public.payment_security set daily_limit")), "no cambia el límite");
  }),
);

test(
  "sin PIN: limits y approve responden 409 no_pin",
  withApiEnv(async () => {
    installPool(() => []);
    const l = await limitsPut(req("/api/security/limits", "PUT", { XLM: 500, pin: GOOD_PIN }));
    assert.equal(l.status, 409);
    assert.equal((await l.json()).code, "no_pin");
    const a = await approvePost(req("/api/security/approve", "POST", { to: BOB, asset: "XLM", amount: 1, pin: GOOD_PIN }));
    assert.equal(a.status, 409);
    assert.equal((await a.json()).code, "no_pin");
  }),
);

test(
  "POST /api/security/pin/reset: con sesión de hace más de 10 minutos = 403 reauth_required y no toca nada",
  withApiEnv(async () => {
    const calls = installPool(() => []);
    const old = sessionAt(Date.now() - 11 * 60_000);
    const res = await pinReset(req("/api/security/pin/reset", "POST", { pin: GOOD_PIN }, old));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, "reauth_required");
    assert.equal(calls.length, 0);
  }),
);

test(
  "POST /api/security/pin/reset: con sesión reciente pone el PIN nuevo, borra el bloqueo e invalida permisos",
  withApiEnv(async () => {
    const calls = installPool((text) => (text.startsWith("insert into public.payment_security") ? [{ profile_id: aliceId }] : []));
    const fresh = sessionAt(Date.now() - 2 * 60_000);
    const res = await pinReset(req("/api/security/pin/reset", "POST", { pin: GOOD_PIN }, fresh));
    assert.equal(res.status, 204);
    const insert = queryOf(calls, "insert into public.payment_security");
    assert.ok(insert);
    assert.match(insert.text, /failed_attempts = 0, lock_level = 0, locked_until = null/);
    assert.ok(!insert.text.includes("where s.pin_hash is null"), "pisa el PIN anterior");
    assert.equal(await verifyPinHash(GOOD_PIN, SECRET_BYTES, { hash: insert.values[1] as string, salt: insert.values[2] as string }), true);
    assert.ok(queryOf(calls, "update public.payment_approvals set used_at = now()"));
    // PIN débil: rechazado aunque la sesión sea reciente.
    const weak = await pinReset(req("/api/security/pin/reset", "POST", { pin: "123456" }, fresh));
    assert.equal(weak.status, 400);
    assert.equal((await weak.json()).code, "weak_pin");
  }),
);

test(
  "PUT /api/security/limits: valida los límites antes de pedir el PIN y devuelve el estado nuevo",
  withApiEnv(async () => {
    const calls = installPool(() => []);
    for (const body of [{ pin: GOOD_PIN }, { USDC: 0, pin: GOOD_PIN }, { XLM: -5, pin: GOOD_PIN }, { USDC: 100001, pin: GOOD_PIN }, { USDC: "abc", pin: GOOD_PIN }]) {
      const res = await limitsPut(req("/api/security/limits", "PUT", body));
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal((await res.json()).code, "invalid_amount");
    }
    const noPin = await limitsPut(req("/api/security/limits", "PUT", { USDC: 50 }));
    assert.equal(noPin.status, 400);
    assert.equal((await noPin.json()).code, "invalid_pin");
    assert.equal(calls.length, 0);

    const stored = await hashPin(GOOD_PIN, SECRET_BYTES);
    let limit = "100.0000000";
    const ok = installPool((text, values) => {
      if (text.startsWith("update public.payment_security s set failed_attempts")) {
        return [{ pin_hash: stored.hash, pin_salt: stored.salt, failed_attempts: 1, locked: false, locked_until: null }];
      }
      if (text.startsWith("update public.payment_security set daily_limit")) {
        limit = values[1] as string;
        return [{ profile_id: aliceId }];
      }
      if (text.startsWith("select (s.pin_hash is not null) as has_pin")) {
        return [{ has_pin: true, locked_until: null, daily_limit_usdc: limit, daily_limit_xlm: "1000.0000000" }];
      }
      return [];
    });
    const res = await limitsPut(req("/api/security/limits", "PUT", { USDC: 250.5, pin: GOOD_PIN }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).dailyLimit.USDC, 250.5);
    const update = queryOf(ok, "update public.payment_security set daily_limit");
    assert.deepEqual(update?.values, [aliceId, "250.5000000", null]);
  }),
);

// -- approve

function approveFixture(over: { spent?: string; limit?: string; failed?: number } = {}) {
  return async () => {
    const stored = await hashPin(GOOD_PIN, SECRET_BYTES);
    const bobProfile = { id: profileIdFromWallet(BOB), wallet: BOB, username: "bob", display_name: "Bob" };
    return installPool((text, values) => {
      if (text.startsWith("update public.payment_security s set failed_attempts")) {
        return [{ pin_hash: stored.hash, pin_salt: stored.salt, failed_attempts: over.failed ?? 1, locked: false, locked_until: null }];
      }
      if (text.includes("from public.profiles p where lower(p.username)")) return values[0] === "bob" ? [bobProfile] : [];
      if (text.includes("from public.profiles p where p.wallet")) return values[0] === BOB ? [bobProfile] : [];
      if (text.startsWith("select s.daily_limit_usdc::text")) {
        return [{ daily_limit_usdc: over.limit ?? "100.0000000", daily_limit_xlm: "1000.0000000" }];
      }
      if (text.startsWith("select a.asset, coalesce(sum")) return [{ asset: "USDC", spent: over.spent ?? "0" }];
      if (text.startsWith("insert into public.payment_approvals")) {
        return [{ id: "5b9f0ed1-ca61-4f5c-9cc6-5c0a0c94c6aa", expires_at: "2026-10-09T12:02:00.000000Z" }];
      }
      return [];
    });
  };
}

test(
  "POST /api/security/approve: @usuario con o sin @, PIN correcto -> 201 con el permiso",
  withApiEnv(async () => {
    for (const to of ["@bob", "bob", "BOB"]) {
      const calls = await approveFixture()();
      const res = await approvePost(req("/api/security/approve", "POST", { to, asset: "USDC", amount: 5, pin: GOOD_PIN }));
      assert.equal(res.status, 201, to);
      assert.deepEqual(await res.json(), {
        id: "5b9f0ed1-ca61-4f5c-9cc6-5c0a0c94c6aa",
        toWallet: BOB,
        toLabel: "@bob",
        asset: "USDC",
        amount: 5,
        expiresAt: "2026-10-09T12:02:00.000000Z",
      });
      const insert = queryOf(calls, "insert into public.payment_approvals");
      assert.deepEqual(insert?.values, [aliceId, BOB, "USDC", "5.0000000", APPROVAL_TTL_MS]);
      assert.ok(calls.some((c) => c.text === "begin") && calls.some((c) => c.text === "commit"), "dentro de una transacción");
      assert.ok(queryOf(calls, "for update"), "con la fila de seguridad bloqueada");
      resetApiLimits();
    }
  }),
);

test(
  "POST /api/security/approve: dirección G… (la de alguien con perfil se muestra como @usuario)",
  withApiEnv(async () => {
    await approveFixture()();
    const res = await approvePost(req("/api/security/approve", "POST", { to: BOB.toLowerCase(), asset: "XLM", amount: "2,5", pin: GOOD_PIN }));
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.toWallet, BOB);
    assert.equal(body.toLabel, "@bob");
    assert.equal(body.amount, 2.5);
    // Una G sin perfil se abrevia.
    const stranger = Keypair.random().publicKey();
    const res2 = await approvePost(req("/api/security/approve", "POST", { to: stranger, asset: "USDC", amount: 1, pin: GOOD_PIN }));
    assert.equal(res2.status, 201);
    assert.equal((await res2.json()).toLabel, `${stranger.slice(0, 4)}…${stranger.slice(-4)}`);
  }),
);

test(
  "POST /api/security/approve: destino y monto inválidos son 400 y no gastan intentos del PIN",
  withApiEnv(async () => {
    const calls = await approveFixture()();
    const cases: [Record<string, unknown>, number, string][] = [
      [{ to: "nadie_existe", asset: "USDC", amount: 5, pin: GOOD_PIN }, 400, "invalid_recipient"],
      [{ to: "", asset: "USDC", amount: 5, pin: GOOD_PIN }, 400, "invalid_recipient"],
      [{ to: 12345, asset: "USDC", amount: 5, pin: GOOD_PIN }, 400, "invalid_recipient"],
      [{ to: ALICE, asset: "USDC", amount: 5, pin: GOOD_PIN }, 400, "invalid_recipient"], // la propia wallet
      [{ to: "bob", asset: "BTC", amount: 5, pin: GOOD_PIN }, 400, "invalid_amount"],
      [{ to: "bob", asset: "USDC", amount: 0, pin: GOOD_PIN }, 400, "invalid_amount"],
      [{ to: "bob", asset: "USDC", amount: -3, pin: GOOD_PIN }, 400, "invalid_amount"],
      [{ to: "bob", asset: "USDC", amount: 0.001, pin: GOOD_PIN }, 400, "invalid_amount"],
      [{ to: "bob", asset: "USDC", amount: 10001, pin: GOOD_PIN }, 400, "invalid_amount"],
      [{ to: "bob", asset: "USDC", amount: "1e3", pin: GOOD_PIN }, 400, "invalid_amount"],
      [{ to: "bob", asset: "USDC", pin: GOOD_PIN }, 400, "invalid_amount"],
      [{ to: "bob", asset: "USDC", amount: 5, pin: "12" }, 400, "invalid_pin"],
      [{ to: "bob", asset: "USDC", amount: 5 }, 400, "invalid_pin"],
    ];
    for (const [body, status, code] of cases) {
      const res = await approvePost(req("/api/security/approve", "POST", body));
      assert.equal(res.status, status, JSON.stringify(body));
      assert.equal((await res.json()).code, code, JSON.stringify(body));
      resetApiLimits();
    }
    assert.ok(!calls.some((c) => c.text.startsWith("update public.payment_security s set failed_attempts")));
    assert.ok(!calls.some((c) => c.text.startsWith("insert into public.payment_approvals")));
  }),
);

test(
  "POST /api/security/approve: PIN incorrecto = 422 wrong_pin y no se crea ningún permiso",
  withApiEnv(async () => {
    const calls = await approveFixture({ failed: 4 })();
    const res = await approvePost(req("/api/security/approve", "POST", { to: "bob", asset: "USDC", amount: 5, pin: "999111" }));
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.code, "wrong_pin");
    assert.equal(body.attemptsLeft, 1);
    assert.match(body.error, /queda 1 intento/);
    assert.ok(!calls.some((c) => c.text.startsWith("insert into public.payment_approvals")));
  }),
);

test(
  "POST /api/security/approve: pasar el límite diario = 403 limit_exceeded con lo que queda",
  withApiEnv(async () => {
    const calls = await approveFixture({ spent: "90.0000000", limit: "100.0000000" })();
    const res = await approvePost(req("/api/security/approve", "POST", { to: "bob", asset: "USDC", amount: 15, pin: GOOD_PIN }));
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, "limit_exceeded");
    assert.equal(body.remaining, 10);
    assert.ok(!calls.some((c) => c.text.startsWith("insert into public.payment_approvals")));
    assert.ok(calls.some((c) => c.text === "commit"), "la transacción se cierra sin dejar nada a medias");
    // Justo en el límite sí cabe.
    resetApiLimits();
    await approveFixture({ spent: "90.0000000", limit: "100.0000000" })();
    const ok = await approvePost(req("/api/security/approve", "POST", { to: "bob", asset: "USDC", amount: 10, pin: GOOD_PIN }));
    assert.equal(ok.status, 201);
  }),
);

test(
  "las rutas del PIN frenan por perfil: más de 10 pedidos por minuto = 429",
  withApiEnv(async () => {
    installPool(() => []);
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await pinPut(req("/api/security/pin", "PUT", { pin: "12" }))).status;
    }
    assert.equal(last, 429);
  }),
);

test(
  "las rutas del PIN piden JSON y sesión",
  withApiEnv(async () => {
    installPool(() => []);
    assert.equal((await pinPut(req("/api/security/pin", "PUT", { pin: GOOD_PIN }, null))).status, 401);
    const badType = new Request("https://kosmovia.test/api/security/pin", { method: "PUT", headers: { cookie: sessionAt(Date.now()), "content-type": "text/plain" }, body: "x" });
    assert.equal((await pinPut(badType)).status, 415);
    const arr = await pinPut(req("/api/security/pin", "PUT", [GOOD_PIN]));
    assert.equal(arr.status, 400);
    assert.equal((await approvePost(req("/api/security/approve", "POST", undefined))).status, 415);
  }),
);

// -- POST /api/payments con approvalId

const HASH = "b".repeat(64);
const APPROVAL_ID = "5b9f0ed1-ca61-4f5c-9cc6-5c0a0c94c6aa";

function horizonOps(over: Record<string, unknown> = {}) {
  return {
    _embedded: {
      records: [
        {
          id: "123456789",
          type: "payment",
          transaction_successful: true,
          transaction_hash: HASH,
          created_at: new Date().toISOString(),
          from: ALICE,
          to: BOB,
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: USDC_ISSUER_TESTNET,
          amount: "5.0000000",
          ...over,
        },
      ],
    },
  };
}

async function withFakeHorizon<T>(ops: unknown, fn: () => Promise<T>): Promise<T> {
  const saved = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(ops), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = saved;
  }
}

const paymentRow = (unverified: boolean) => ({
  id: "7c1d9e4a-1111-4222-8333-444455556666",
  tx_hash: HASH,
  from_wallet: ALICE,
  to_wallet: BOB,
  asset: "USDC",
  amount: "5.0000000",
  note: null,
  paid_at: "2026-10-09T12:00:00.000000Z",
  unverified,
  from_profile: null,
  to_profile: null,
});

function paymentsPool(claimMatches: boolean, opts: { conflict?: boolean } = {}) {
  return installPool((text) => {
    if (text.startsWith("update public.payment_approvals a set used_at")) return claimMatches ? [{ id: APPROVAL_ID }] : [];
    if (text.startsWith("with ins as")) return opts.conflict ? [] : [paymentRow(!claimMatches)];
    if (text.includes("where py.op_id = $1 and py.from_wallet = $2")) return [paymentRow(false)];
    return [];
  });
}

const postPayment = (body: Record<string, unknown>) =>
  withFakeHorizon(horizonOps(), () => paymentsPost(req("/api/payments", "POST", { hash: HASH, ...body })));

test(
  "POST /api/payments: el permiso que coincide se consume, se liga al pago y no queda unverified",
  withApiEnv(async () => {
    const calls = paymentsPool(true);
    const res = await postPayment({ approvalId: APPROVAL_ID });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).payment.unverified, false);
    const claim = queryOf(calls, "update public.payment_approvals a set used_at");
    assert.ok(claim);
    // perfil de la sesión, destino y monto de LO QUE VIO HORIZON (no del cuerpo)
    assert.deepEqual(claim.values.slice(0, 5), [APPROVAL_ID, aliceId, BOB, "USDC", "5.0000000"]);
    assert.equal(claim.values[6], APPROVAL_GRACE_MS);
    const insert = queryOf(calls, "with ins as");
    assert.deepEqual(insert?.values.slice(9), [APPROVAL_ID, false]);
    const link = queryOf(calls, "set payment_id = $2");
    assert.deepEqual(link?.values, [APPROVAL_ID, paymentRow(false).id]);
  }),
);

test(
  "POST /api/payments: permiso que no coincide (monto, destino, vencido, usado) se guarda igual como unverified",
  withApiEnv(async () => {
    // El UPDATE del permiso no devuelve fila: no coincide con lo que pasó en Horizon.
    const calls = paymentsPool(false);
    const res = await postPayment({ approvalId: APPROVAL_ID });
    assert.equal(res.status, 201, "nunca se rechaza el registro: el dinero ya se movió");
    assert.equal((await res.json()).payment.unverified, true);
    const insert = queryOf(calls, "with ins as");
    assert.deepEqual(insert?.values.slice(9), [null, true]);
    assert.ok(!queryOf(calls, "set payment_id = $2"));
  }),
);

test(
  "POST /api/payments: sin approvalId o con uno inválido también se guarda, unverified, y ni se intenta consumir",
  withApiEnv(async () => {
    for (const body of [{}, { approvalId: 5 }, { approvalId: "no-es-uuid" }, { approvalId: null }]) {
      const calls = paymentsPool(false);
      const res = await postPayment(body);
      assert.equal(res.status, 201, JSON.stringify(body));
      assert.deepEqual(queryOf(calls, "with ins as")?.values.slice(9), [null, true]);
      assert.ok(!queryOf(calls, "update public.payment_approvals a set used_at"), JSON.stringify(body));
      resetApiLimits();
    }
  }),
);

test(
  "POST /api/payments: si la operación ya estaba registrada, el permiso tomado se libera y se devuelve el pago existente",
  withApiEnv(async () => {
    const calls = paymentsPool(true, { conflict: true });
    const res = await postPayment({ approvalId: APPROVAL_ID });
    assert.equal(res.status, 200);
    assert.ok(queryOf(calls, "set used_at = null where id = $1 and payment_id is null"), "vuelve a quedar sin usar");
    assert.ok(!queryOf(calls, "set payment_id = $2"));
  }),
);

test(
  "POST /api/payments: si guardar falla, el permiso se libera para que el reintento del cliente lo use",
  withApiEnv(async () => {
    const calls = installPool((text) => {
      if (text.startsWith("update public.payment_approvals a set used_at")) return [{ id: APPROVAL_ID }];
      if (text.startsWith("with ins as")) throw Object.assign(new Error("boom"), { code: "57P01" });
      return [];
    });
    const res = await postPayment({ approvalId: APPROVAL_ID });
    assert.equal(res.status, 500);
    assert.ok(queryOf(calls, "set used_at = null where id = $1 and payment_id is null"));
  }),
);

test(
  "GET /api/payments: expone unverified solo a quien envió",
  withApiEnv(async () => {
    const calls = installPool(() => [paymentRow(true)]);
    const res = await paymentsGet(req("/api/payments", "GET"));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).payments[0].unverified, true);
    assert.match(calls[0].text, /\(py\.unverified and py\.from_wallet = \$1\) as unverified/);
  }),
);
