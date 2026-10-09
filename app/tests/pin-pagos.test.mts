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
import { DELETE as pinResetCancel, POST as pinReset } from "../app/api/security/pin/reset/route.ts";
import { PUT as limitsPut } from "../app/api/security/limits/route.ts";
import { POST as approvePost } from "../app/api/security/approve/route.ts";
import { POST as paymentsPost, GET as paymentsGet } from "../app/api/payments/route.ts";
import { resetApiLimits } from "../lib/core/api-limits.ts";
import * as q from "../lib/core/db/sql.ts";
import { profileIdFromWallet } from "../lib/core/ids.ts";
import { MIN_APPROVAL_LEFT_MS, SEND_TIMEOUT_SEC, approvalTimeoutSec } from "../lib/core/payments.ts";
import { USDC_ISSUER_TESTNET } from "../lib/core/pollar-config.ts";
import {
  APPROVAL_GRACE_MS,
  APPROVAL_TTL_MS,
  LOCK_MAX_MS,
  MAX_FAILED_ATTEMPTS,
  PIN_HASH_VERSION,
  PIN_RESET_DELAY_MS,
  approvalMatches,
  attemptsLeft,
  checkApprovalForPayment,
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
  type CurrentPin,
  type FailureState,
} from "../lib/core/pin.ts";
import { SESSION_COOKIE, signSessionCookie } from "../lib/core/session-cookie.ts";
import { createApprovalSlot } from "../components/approvalSlot.ts";

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
  pinVersion: 3,
};
/** El PIN vigente: versión 3, puesto una hora antes del permiso. */
const PIN_NOW = { version: 3, setAt: T0 - 3_600_000 };
const matches = (a: ApprovalFacts, p: typeof paymentOk, pin: CurrentPin = PIN_NOW) => approvalMatches(a, p, pin);
const paymentOk = { profileId: aliceId, toWallet: BOB, asset: "USDC", amount: "5", paidAt: T0 + 20_000 };

test("approvalMatches: mismo perfil, destino, activo, monto exacto, sin usar y a tiempo", () => {
  assert.equal(matches(approvalOk, paymentOk), true);
  assert.equal(matches(approvalOk, { ...paymentOk, amount: "5.0000000" }), true, "5 = 5.0000000");
  assert.equal(APPROVAL_TTL_MS, 5 * 60 * 1000, "el permiso dura 5 minutos, como la transacción");
});

test("approvalMatches: monto distinto, otro destino, otro activo u otro perfil -> unverified", () => {
  assert.equal(matches(approvalOk, { ...paymentOk, amount: "5.0000001" }), false);
  assert.equal(matches(approvalOk, { ...paymentOk, amount: "4.9999999" }), false);
  assert.equal(matches(approvalOk, { ...paymentOk, amount: "50" }), false);
  assert.equal(matches(approvalOk, { ...paymentOk, toWallet: CAROL }), false);
  assert.equal(matches(approvalOk, { ...paymentOk, asset: "XLM" }), false);
  assert.equal(matches(approvalOk, { ...paymentOk, profileId: profileIdFromWallet(BOB) }), false);
  assert.equal(matches({ ...approvalOk, amount: "x" }, paymentOk), false);
});

test("approvalMatches: usado, vencido o anterior al permiso -> unverified", () => {
  assert.equal(matches({ ...approvalOk, usedAt: T0 + 5_000 }, paymentOk), false, "un permiso se usa una sola vez");
  // Vencido: el pago cerró más de 60 s después de que venció.
  const expiry = approvalOk.expiresAt;
  assert.equal(matches(approvalOk, { ...paymentOk, paidAt: expiry + APPROVAL_GRACE_MS }), true, "justo en la holgura");
  assert.equal(matches(approvalOk, { ...paymentOk, paidAt: expiry + APPROVAL_GRACE_MS + 1 }), false);
  assert.equal(matches(approvalOk, { ...paymentOk, paidAt: expiry + 10 * 60_000 }), false);
  // Un pago anterior al permiso no lo puede usar.
  assert.equal(matches(approvalOk, { ...paymentOk, paidAt: T0 - APPROVAL_GRACE_MS }), true);
  assert.equal(matches(approvalOk, { ...paymentOk, paidAt: T0 - APPROVAL_GRACE_MS - 1 }), false);
});

test("sessionIsFresh: la sesión tiene que ser de hace menos de 10 minutos", () => {
  assert.equal(sessionIsFresh(T0 - 9 * 60_000, T0), true);
  assert.equal(sessionIsFresh(T0 - 10 * 60_000, T0), false);
  assert.equal(sessionIsFresh(T0 - 11 * 60_000, T0), false);
  assert.equal(sessionIsFresh(T0, T0), true);
  assert.equal(sessionIsFresh(T0 + 90_000, T0), false, "un iat del futuro lejano no vale");
  assert.equal(sessionIsFresh(NaN, T0), false);
});

test("approvalMatches: la versión del PIN decide (vigente, o el pago cerró antes del cambio)", () => {
  // Permiso de la versión vigente: cuenta.
  assert.equal(matches(approvalOk, paymentOk), true);
  // Permiso de un PIN anterior y el pago cerró DESPUÉS del cambio: no cuenta (unverified).
  const changedBefore = { version: 4, setAt: T0 - 10_000 };
  assert.equal(matches(approvalOk, paymentOk, changedBefore), false);
  // Permiso de un PIN anterior pero el pago cerró ANTES del cambio: el permiso valía entonces, cuenta.
  const changedAfter = { version: 4, setAt: T0 + 60_000 };
  assert.equal(matches(approvalOk, paymentOk, changedAfter), true);
  // Justo en el instante del cambio ya es "después".
  assert.equal(matches(approvalOk, paymentOk, { version: 4, setAt: paymentOk.paidAt }), false);
  // Sin saber cuándo cambió: lo más seguro es no contarlo.
  assert.equal(matches(approvalOk, paymentOk, { version: 4, setAt: null }), false);
  // La misma versión siempre cuenta, aunque el PIN se haya puesto antes.
  assert.equal(matches({ ...approvalOk, pinVersion: 9 }, paymentOk, { version: 9, setAt: T0 - 1 }), true);
});

test("approvalTimeoutSec: la transacción nunca vive más que el permiso y con menos de 30 s no se firma", () => {
  const now = T0;
  assert.equal(SEND_TIMEOUT_SEC, 300);
  assert.equal(MIN_APPROVAL_LEFT_MS, 30_000);
  assert.deepEqual(approvalTimeoutSec(now + 5 * 60_000, now), { ok: true, timeoutSec: 300 }, "permiso recién creado: la vida normal");
  assert.deepEqual(approvalTimeoutSec(now + 100_000, now), { ok: true, timeoutSec: 100 }, "se limita a lo que le queda");
  assert.deepEqual(approvalTimeoutSec(now + 100_900, now), { ok: true, timeoutSec: 100 }, "redondea hacia abajo");
  assert.deepEqual(approvalTimeoutSec(now + 30_000, now), { ok: true, timeoutSec: 30 });
  assert.deepEqual(approvalTimeoutSec(now + 29_999, now), { ok: false });
  assert.deepEqual(approvalTimeoutSec(now - 1, now), { ok: false });
  assert.deepEqual(approvalTimeoutSec(NaN, now), { ok: false });
  assert.deepEqual(approvalTimeoutSec(now + 10 * 60_000, now), { ok: true, timeoutSec: 300 }, "nunca más de 5 minutos");
});

test("checkApprovalForPayment: destino, activo, monto y tiempo del permiso antes de firmar", () => {
  const approval = { toWallet: BOB, asset: "USDC", amount: 5, expiresAt: new Date(T0 + 5 * 60_000).toISOString() };
  const payment = { destination: BOB, asset: "USDC" as const, amount: "5.0000000" };
  assert.deepEqual(checkApprovalForPayment(approval, payment, T0), { ok: true, timeoutSec: 300 });
  // El destino que se quiere pagar tiene que ser EXACTAMENTE el aprobado.
  const other = checkApprovalForPayment(approval, { ...payment, destination: CAROL }, T0);
  assert.ok(!other.ok && other.code === "destination" && /destino no coincide/.test(other.error));
  const amount = checkApprovalForPayment(approval, { ...payment, amount: "5.0000001" }, T0);
  assert.ok(!amount.ok && amount.code === "amount");
  const asset = checkApprovalForPayment(approval, { ...payment, asset: "XLM" }, T0);
  assert.ok(!asset.ok && asset.code === "amount");
  // Con menos de 30 s de vida no se firma: hay que confirmar de nuevo.
  const late = checkApprovalForPayment(approval, payment, T0 + 5 * 60_000 - 29_000);
  assert.ok(!late.ok && late.code === "expired");
  // Con 100 s de vida, la transacción dura 100 s.
  assert.deepEqual(checkApprovalForPayment(approval, payment, T0 + 5 * 60_000 - 100_000), { ok: true, timeoutSec: 100 });
});

test("PaymentGuard: cada solicitud tiene su id; una respuesta tardía de una cancelada o reemplazada se ignora", () => {
  const slot = createApprovalSlot<{ to: string }, string>();
  const done: Record<string, string | null> = {};
  const a = slot.open({ to: "A" }, (r) => (done.A = r));
  assert.ok(slot.isActive(a.id));
  // Se abre B (a la misma persona, mismo monto): A queda cancelada (resuelve null).
  const b = slot.open({ to: "B" }, (r) => (done.B = r));
  assert.equal(done.A, null);
  assert.ok(!slot.isActive(a.id) && slot.isActive(b.id));
  // La respuesta tardía de A NO resuelve la solicitud de B.
  assert.equal(slot.finish(a.id, "permiso-de-A"), false);
  assert.equal("B" in done, false);
  assert.equal(slot.current()?.id, b.id);
  // B sí se resuelve con lo suyo, y una sola vez.
  assert.equal(slot.finish(b.id, "permiso-de-B"), true);
  assert.equal(done.B, "permiso-de-B");
  assert.equal(slot.finish(b.id, "otro"), false);
  assert.equal(slot.current(), null);
  // Cancelar (null) también es solo de la propia solicitud.
  const c = slot.open({ to: "C" }, (r) => (done.C = r));
  assert.equal(slot.finish(c.id + 1, null), false);
  assert.equal(slot.finish(c.id, null), true);
  assert.equal(done.C, null);
});

test("0011_pin_ajustes.sql: versión del PIN, reset pendiente, versión en permisos y permiso único por pago", () => {
  const sql = readFileSync(new URL("../db/migrations/0011_pin_ajustes.sql", import.meta.url), "utf8");
  assert.match(sql, /alter table public\.payment_security add column if not exists pin_version integer not null default 0/);
  for (const col of ["pending_pin_hash text null", "pending_pin_salt text null", "pending_pin_at timestamptz null"]) {
    assert.ok(sql.includes(`add column if not exists ${col}`), col);
  }
  assert.match(sql, /alter table public\.payment_approvals add column if not exists pin_version integer not null default 0/);
  assert.match(sql, /create unique index if not exists payments_approval_id_key\s+on public\.payments \(approval_id\) where approval_id is not null/);
  assert.match(sql, /\(pending_pin_hash is null\) = \(pending_pin_salt is null\)/);
  assert.match(sql, /\(pending_pin_hash is null\) = \(pending_pin_at is null\)/);
  // Idempotente y sin tocar la 0009.
  assert.ok(!/create table (?!if not exists)/i.test(sql));
  for (const add of sql.match(/add constraint (\w+)/g) ?? []) {
    assert.ok(sql.includes(`drop constraint if exists ${add.replace("add constraint ", "")}`), add);
  }
  assert.ok(!/drop table|drop column/i.test(sql));
});

test("textos de la UI: no prometen que el PIN impide toda firma; avisan que es de la app y que se marca «Sin PIN»", () => {
  const guard = readFileSync(new URL("../components/PaymentGuard.tsx", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../components/SecuritySettings.tsx", import.meta.url), "utf8");
  for (const text of [guard, settings]) {
    assert.ok(!/nadie podrá mover/i.test(text), "no promete que nadie puede mover los fondos");
    assert.match(text, /protección de la app/);
    assert.match(text, /Sin PIN/);
  }
  // Punto 2b: al abrir sin PIN se ofrece crearlo, y "Ahora no" lo pospone.
  assert.match(guard, /function SetupPinDialog/);
  assert.match(guard, /getStatus\(\)[\s\S]{0,200}!s\.hasPin[\s\S]{0,40}setSetupOpen\(true\)/);
  assert.match(guard, /Ahora no/);
  assert.match(guard, /sessionStorage\.setItem\(SETUP_LATER_KEY/);
  // Punto 2c: el aviso del reset pendiente con su hora y el botón de cancelar (pide el PIN actual).
  assert.match(settings, /Cambio de PIN pendiente/);
  assert.match(settings, /fmtDateTime\(status\.pendingPinAt\)/);
  assert.match(settings, /cancelPinReset\(cancelPin\)/);
});

test("sendPayment (api): resuelve input.to, exige el destino aprobado y limita la vida de la transacción al permiso", () => {
  const src = readFileSync(new URL("../services/api/index.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("async sendPayment(input: SendPaymentInput)"));
  assert.match(body, /Confirma el pago con tu PIN\./);
  assert.match(body, /HANDLE_RE\.test\(handle\)[\s\S]{0,200}\/api\/profiles\//, "resuelve el @usuario como antes");
  assert.match(body, /checkApprovalForPayment\(approval, \{ destination,/, "compara el destino resuelto con el aprobado");
  assert.match(body, /paymentOptions\(memo, life\.timeoutSec\)/);
  assert.match(body, /approvalId: approval\.id/);
  // El control de destino va antes de firmar.
  assert.ok(body.indexOf("checkApprovalForPayment(") < body.indexOf("client.sendPayment("));
});

// ---------------------------------------------------------------- SQL

const HOSTILE = "x'; drop table payment_security; --";
const POLICY = { maxAttempts: 5, baseMs: 15 * 60_000, maxMs: LOCK_MAX_MS, maxLevel: 30 };

test("el SQL del PIN va parametrizado (nada del usuario entra al texto)", () => {
  const queries = [
    q.securityRow(HOSTILE),
    q.approvedLast24h(HOSTILE),
    q.lockSecurityForPin(HOSTILE),
    q.activatePendingPin(HOSTILE),
    q.reservePinAttempt(HOSTILE, POLICY),
    q.clearPinFailures(HOSTILE),
    q.createPin(HOSTILE, HOSTILE, HOSTILE),
    q.changePin(HOSTILE, HOSTILE, HOSTILE, 1),
    q.securityForReset(HOSTILE),
    q.resetPinNow(HOSTILE, HOSTILE, HOSTILE),
    q.setPendingPin(HOSTILE, HOSTILE, HOSTILE, PIN_RESET_DELAY_MS),
    q.cancelPendingPin(HOSTILE),
    q.expirePendingApprovals(HOSTILE),
    q.setDailyLimits(HOSTILE, HOSTILE, null, 1),
    q.lockSecurityRow(HOSTILE, 1),
    q.insertApproval({ profileId: HOSTILE, toWallet: HOSTILE, asset: HOSTILE, amount: HOSTILE, ttlMs: APPROVAL_TTL_MS, pinVersion: 1 }),
    q.claimApproval({ approvalId: HOSTILE, profileId: HOSTILE, toWallet: HOSTILE, asset: HOSTILE, amount: HOSTILE, paidAt: HOSTILE, graceMs: 1 }),
    q.linkApproval(HOSTILE, HOSTILE),
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
  assert.match(query.text, /returning s\.pin_hash, s\.pin_salt, s\.pin_version/);
  // La política viaja como parámetros: 5 fallos, 15 min, tope 24 h, nivel máximo 30.
  assert.deepEqual(query.values, ["p", 5, 900_000, 86_400_000, 30]);
});

test("claimApproval: perfil, destino, activo, monto exacto, sin usar y dentro de la vida del permiso", () => {
  const query = q.claimApproval({ approvalId: "a", profileId: "p", toWallet: "w", asset: "USDC", amount: "5", paidAt: "2026-10-09T12:00:00Z", graceMs: 60_000 });
  assert.match(query.text, /set used_at = now\(\)/);
  for (const part of [
    "a.id = $1::uuid", "a.profile_id = $2", "a.to_wallet = $3", "a.asset = $4", "a.amount = $5::numeric", "a.used_at is null",
    "$6::timestamptz <= a.expires_at +", "$6::timestamptz >= a.created_at -",
    "from public.payment_security s", "(a.pin_version = s.pin_version or $6::timestamptz < s.pin_set_at)",
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

/**
 * Pool falso con `query` y `connect`. Cada conexión anota sus sentencias en `calls`
 * (con el número de conexión) y, como en Postgres, `select … for update` sobre la fila
 * de seguridad espera hasta que la transacción que la tiene bloqueada hace commit o rollback.
 */
function installPool(handler: (text: string, values: unknown[]) => unknown[]): Call[] & { conn: number[] } {
  const calls = Object.assign([] as Call[], { conn: [] as number[] });
  let connSeq = 0;
  let holder: number | null = null;
  const waiters: Array<() => void> = [];
  const release = (id: number) => {
    if (holder === id) {
      holder = null;
      waiters.shift()?.();
    }
  };
  const clientFor = (id: number) => ({
    async query(text: string, values?: unknown[]) {
      if (text.startsWith("select s.profile_id from public.payment_security s") && text.includes("for update")) {
        while (holder !== null && holder !== id) await new Promise<void>((resolve) => waiters.push(resolve));
        holder = id;
      }
      calls.push({ text, values: values ?? [] });
      calls.conn.push(id);
      let rows: unknown[];
      try {
        rows = handler(text, values ?? []);
      } catch (err) {
        throw err;
      }
      if (text === "commit" || text === "rollback") release(id);
      return { rows };
    },
    release() {
      release(id);
    },
  });
  (globalThis as Record<symbol, unknown>)[POOL_KEY] = {
    query: (text: string, values?: unknown[]) => clientFor(0).query(text, values),
    async connect() {
      return clientFor(++connSeq);
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
const has = (calls: Call[], fragment: string) => calls.some((c) => c.text.includes(fragment));
const indexOf = (calls: Call[], fragment: string) => calls.findIndex((c) => c.text.includes(fragment));

// Textos de las sentencias, para que el pool falso las reconozca.
const T = {
  lockPin: "select s.profile_id from public.payment_security s",
  activate: "with act as (",
  reserve: "update public.payment_security s set failed_attempts",
  clear: "update public.payment_security set failed_attempts = 0",
  status: "select (s.pin_hash is not null) as has_pin, to_char(",
  forReset: "(s.pending_pin_hash is not null) as has_pending",
  createPin: "insert into public.payment_security as s",
  change: "with chg as (",
  pending: "update public.payment_security set pending_pin_hash = $2",
  cancel: "update public.payment_security set pending_pin_hash = null",
  expire: "update public.payment_approvals set expires_at = now()",
  limits: "update public.payment_security set daily_limit",
  lockRow: "select s.daily_limit_usdc::text",
  spent: "select a.asset, coalesce(sum",
  insertApproval: "insert into public.payment_approvals",
  claim: "update public.payment_approvals a set used_at",
  link: "update public.payment_approvals set payment_id",
  insertPayment: "with ins as",
};

interface PinWorld {
  /** Hash guardado del PIN actual (sin esto, la persona no tiene PIN). */
  stored?: { hash: string; salt: string };
  version?: number;
  failed?: number;
  /** El 5.º fallo bloqueó: el reserve devuelve locked. */
  locksNow?: string;
  /** Hay un bloqueo vigente: el reserve no devuelve fila. */
  lockedUntil?: string;
  pendingAt?: string;
  limit?: string;
  spent?: string;
  /** El cambio de PIN / límites / permiso no encuentra la versión. */
  versionMoved?: boolean;
  /** Un `activatePendingPin` que sí activa. */
  activates?: boolean;
  extra?: (text: string, values: unknown[]) => unknown[] | undefined;
}

function pinWorld(w: PinWorld = {}) {
  const version = w.version ?? 3;
  return (text: string, values: unknown[]): unknown[] => {
    const extra = w.extra?.(text, values);
    if (extra) return extra;
    if (text.startsWith(T.lockPin)) return w.stored || w.lockedUntil ? [{ profile_id: aliceId }] : [];
    if (text.startsWith(T.activate)) return w.activates ? [{ profile_id: aliceId }] : [];
    if (text.startsWith(T.reserve)) {
      if (!w.stored || w.lockedUntil) return [];
      return [
        {
          pin_hash: w.stored.hash,
          pin_salt: w.stored.salt,
          pin_version: version,
          failed_attempts: w.locksNow ? 0 : (w.failed ?? 1),
          locked: Boolean(w.locksNow),
          locked_until: w.locksNow ?? null,
        },
      ];
    }
    if (text.startsWith(T.status)) {
      if (!w.stored) return [];
      return [
        {
          has_pin: true,
          locked_until: w.lockedUntil ?? null,
          pending_pin_at: w.pendingAt ?? null,
          daily_limit_usdc: w.limit ?? "100.0000000",
          daily_limit_xlm: "1000.0000000",
        },
      ];
    }
    if (text.includes(T.forReset)) {
      if (!w.stored) return [];
      return [{ has_pin: true, has_pending: Boolean(w.pendingAt), pending_pin_at: w.pendingAt ?? null }];
    }
    if (text.startsWith(T.createPin)) {
      // createPin (where s.pin_hash is null): solo crea si no hay PIN. resetPinNow: siempre.
      if (text.includes("where s.pin_hash is null")) return w.stored ? [] : [{ profile_id: aliceId }];
      return [{ profile_id: aliceId }];
    }
    if (text.startsWith(T.change)) return w.versionMoved ? [] : [{ profile_id: aliceId }];
    if (text.startsWith(T.pending)) return [{ pending_pin_at: "2026-10-10T12:00:00.000000Z" }];
    if (text.startsWith(T.cancel)) return [{ profile_id: aliceId }];
    if (text.startsWith(T.limits)) return w.versionMoved ? [] : [{ profile_id: aliceId }];
    if (text.startsWith(T.lockRow)) {
      return w.versionMoved ? [] : [{ daily_limit_usdc: w.limit ?? "100.0000000", daily_limit_xlm: "1000.0000000" }];
    }
    if (text.startsWith(T.spent)) return [{ asset: "USDC", spent: w.spent ?? "0" }];
    if (text.startsWith(T.insertApproval)) return [{ id: APPROVAL_ID, expires_at: "2026-10-09T12:05:00.000000Z" }];
    return [];
  };
}

const APPROVAL_ID = "5b9f0ed1-ca61-4f5c-9cc6-5c0a0c94c6aa";

async function storedPin(pin = GOOD_PIN) {
  return hashPin(pin, SECRET_BYTES);
}

// -- GET /api/security

test(
  "GET /api/security: pide sesión y devuelve el estado sin hash ni sal",
  withApiEnv(async () => {
    const anon = await securityGet(req("/api/security", "GET", undefined, null));
    assert.equal(anon.status, 401);

    const stored = await storedPin();
    const calls = installPool(pinWorld({ stored, spent: "12.5000000", pendingAt: "2026-10-10T12:00:00.000000Z" }));
    const res = await securityGet(req("/api/security", "GET"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, {
      hasPin: true,
      lockedUntil: null,
      pendingPinAt: "2026-10-10T12:00:00.000000Z",
      dailyLimit: { USDC: 100, XLM: 1000 },
      spentToday: { USDC: 12.5, XLM: 0 },
    });
    assert.ok(!JSON.stringify(body).includes(stored.hash) && !JSON.stringify(body).includes(stored.salt));
    assert.ok(calls.every((c) => c.values.includes(aliceId)), "siempre el perfil de la sesión");
    assert.ok(indexOf(calls, T.activate) >= 0 && indexOf(calls, T.activate) < indexOf(calls, T.status), "activa un reset vencido antes de leer");
  }),
);

test(
  "GET /api/security: sin fila = sin PIN y con los límites por defecto",
  withApiEnv(async () => {
    installPool(pinWorld());
    const body = await (await securityGet(req("/api/security", "GET"))).json();
    assert.deepEqual(body, {
      hasPin: false,
      lockedUntil: null,
      pendingPinAt: null,
      dailyLimit: { USDC: 100, XLM: 1000 },
      spentToday: { USDC: 0, XLM: 0 },
    });
  }),
);

// -- PUT /api/security/pin

test(
  "PUT /api/security/pin: PIN inválido o débil se rechaza antes de tocar la base",
  withApiEnv(async () => {
    const calls = installPool(pinWorld());
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
    const calls = installPool(pinWorld());
    const res = await pinPut(req("/api/security/pin", "PUT", { pin: GOOD_PIN }));
    assert.equal(res.status, 204);
    const insert = queryOf(calls, T.createPin);
    assert.ok(insert);
    assert.match(insert.text, /where s\.pin_hash is null/, "no pisa un PIN que ya existe");
    assert.match(insert.text, /pin_version = s\.pin_version \+ 1/, "cada PIN nuevo sube la versión");
    const [profile, hash, salt] = insert.values as string[];
    assert.equal(profile, aliceId);
    assert.equal(await verifyPinHash(GOOD_PIN, SECRET_BYTES, { hash, salt }), true);
    assert.ok(!JSON.stringify(calls).includes(GOOD_PIN), "el PIN en claro nunca llega a la base");
  }),
);

test(
  "PUT /api/security/pin: con PIN previo exige el actual (409 pin_exists) y no gasta intentos",
  withApiEnv(async () => {
    const calls = installPool(pinWorld({ stored: await storedPin() }));
    const res = await pinPut(req("/api/security/pin", "PUT", { pin: "135792" }));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, "pin_exists");
    assert.ok(!has(calls, T.reserve));
  }),
);

test(
  "PUT /api/security/pin: cambiar el PIN verifica el actual y cambia SOLO si sigue en la misma versión",
  withApiEnv(async () => {
    const stored = await storedPin();
    const calls = installPool(pinWorld({ stored, version: 7 }));
    const res = await pinPut(req("/api/security/pin", "PUT", { pin: "135792", currentPin: GOOD_PIN }));
    assert.equal(res.status, 204);
    const change = queryOf(calls, T.change);
    assert.ok(change);
    assert.deepEqual(change.values.slice(0, 1).concat(change.values.slice(3)), [aliceId, 7], "con la versión que se verificó");
    assert.equal(await verifyPinHash("135792", SECRET_BYTES, { hash: change.values[1] as string, salt: change.values[2] as string }), true);
    // Un solo statement: sube la versión, borra el reset pendiente e invalida los permisos pendientes.
    assert.match(change.text, /pin_version = pin_version \+ 1/);
    assert.match(change.text, /pending_pin_hash = null, pending_pin_salt = null, pending_pin_at = null/);
    assert.match(change.text, /update public\.payment_approvals set expires_at = now\(\)/);
    assert.match(change.text, /where profile_id = \$1 and pin_hash is not null and pin_version = \$4/);
  }),
);

test(
  "PUT /api/security/pin: si el PIN cambió entre la verificación y el cambio = 409 pin_changed y no se pisa nada",
  withApiEnv(async () => {
    installPool(pinWorld({ stored: await storedPin(), versionMoved: true }));
    const res = await pinPut(req("/api/security/pin", "PUT", { pin: "135792", currentPin: GOOD_PIN }));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, "pin_changed");
  }),
);

test(
  "PUT /api/security/pin: PIN actual incorrecto = 422 wrong_pin con los intentos que quedan (no 401); el fallo se guarda",
  withApiEnv(async () => {
    const calls = installPool(pinWorld({ stored: await storedPin(), failed: 3 }));
    const res = await pinPut(req("/api/security/pin", "PUT", { pin: "135792", currentPin: "999111" }));
    assert.equal(res.status, 422);
    assert.notEqual(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, "wrong_pin");
    assert.equal(body.attemptsLeft, 2);
    assert.ok(!has(calls, T.change), "no cambia nada");
    assert.ok(!has(calls, T.clear), "un fallo no limpia los fallos");
    assert.equal(calls.at(-1)?.text, "commit", "el intento fallido queda registrado (commit, no rollback)");
  }),
);

test(
  "PUT /api/security/pin: el 5.º fallo bloquea (423 locked con lockedUntil) aunque siga con el PIN equivocado",
  withApiEnv(async () => {
    const until = "2026-10-09T12:15:00.000000Z";
    installPool(pinWorld({ stored: await storedPin(), locksNow: until }));
    const res = await pinPut(req("/api/security/pin", "PUT", { pin: "135792", currentPin: "999111" }));
    assert.equal(res.status, 423);
    assert.deepEqual(await res.json(), { error: "Demasiados intentos. Tu PIN está bloqueado por un rato.", code: "locked", lockedUntil: until });
  }),
);

// -- verificación serializada (punto 6)

test(
  "checkPin: reserva, scrypt y resultado van en UNA transacción con la fila bloqueada, y un acierto limpia los fallos",
  withApiEnv(async () => {
    const calls = installPool(pinWorld({ stored: await storedPin() }));
    const res = await limitsPut(req("/api/security/limits", "PUT", { USDC: 50, pin: GOOD_PIN }));
    assert.equal(res.status, 200);
    const order = [
      calls.findIndex((c) => c.text === "begin"),
      indexOf(calls, T.lockPin),
      indexOf(calls, T.activate),
      indexOf(calls, T.reserve),
      indexOf(calls, T.clear),
      calls.findIndex((c) => c.text === "commit"),
    ];
    assert.ok(order.every((i) => i >= 0), JSON.stringify(order));
    assert.deepEqual([...order].sort((a, b) => a - b), order, "begin < lock < activar < reservar < limpiar < commit");
    assert.match(calls[order[1]].text, /for update$/);
    // Todas esas sentencias son de la misma conexión.
    assert.equal(new Set(calls.conn.slice(order[0], order[5] + 1)).size, 1);
  }),
);

test(
  "checkPin concurrente: un acierto no borra los fallos de otro intento (las verificaciones no se intercalan)",
  withApiEnv(async () => {
    const stored = await storedPin();
    const calls = installPool(pinWorld({ stored }));
    const repo = await import("../lib/core/db/repo.ts");
    const results = await Promise.all([
      repo.checkPin(aliceId, GOOD_PIN, SECRET_BYTES), // acierto
      repo.checkPin(aliceId, "999111", SECRET_BYTES), // fallo
      repo.checkPin(aliceId, "999222", SECRET_BYTES), // fallo
    ]);
    assert.deepEqual(results.map((r) => r.ok), [true, false, false]);
    // Cada transacción ocupa un tramo continuo del registro (el `begin` no espera el lock, así que no cuenta):
    // nunca se mezclan sentencias de dos conexiones.
    const entries = calls.map((c, i) => ({ conn: calls.conn[i], text: c.text })).filter((e) => e.text !== "begin");
    const runs = entries.filter((e, i) => i > 0 && e.conn !== entries[i - 1].conn).length;
    assert.equal(runs, 2, "tres tramos seguidos, uno por conexión");
    // La limpieza de fallos del acierto cae dentro de SU tramo; los fallos de las otras dos no se borran.
    const clears = entries.filter((e) => e.text.startsWith(T.clear));
    assert.equal(clears.length, 1);
    const winner = clears[0].conn;
    const wrongOnes = entries.filter((e) => e.text.startsWith(T.reserve) && e.conn !== winner);
    assert.equal(wrongOnes.length, 2);
    const lastOfWinner = entries.map((e) => e.conn).lastIndexOf(winner);
    const clearAt = entries.findIndex((e) => e.text.startsWith(T.clear));
    assert.ok(clearAt <= lastOfWinner && entries.slice(clearAt, lastOfWinner + 1).every((e) => e.conn === winner));
  }),
);

test(
  "bloqueado: el PIN correcto tampoco se verifica (el UPDATE no devuelve fila) -> 423 sin mirar el hash",
  withApiEnv(async () => {
    const until = "2026-10-09T12:15:00.000000Z";
    const calls = installPool(pinWorld({ stored: await storedPin(), lockedUntil: until }));
    const res = await limitsPut(req("/api/security/limits", "PUT", { USDC: 50, pin: GOOD_PIN }));
    assert.equal(res.status, 423);
    assert.equal((await res.json()).lockedUntil, until);
    assert.ok(!has(calls, T.limits), "no cambia el límite");
    assert.ok(!has(calls, T.clear));
  }),
);

test(
  "sin PIN: limits y approve responden 409 no_pin",
  withApiEnv(async () => {
    installPool(pinWorld());
    const l = await limitsPut(req("/api/security/limits", "PUT", { XLM: 500, pin: GOOD_PIN }));
    assert.equal(l.status, 409);
    assert.equal((await l.json()).code, "no_pin");
    const a = await approvePost(req("/api/security/approve", "POST", { to: BOB, asset: "XLM", amount: 1, pin: GOOD_PIN }));
    assert.equal(a.status, 409);
    assert.equal((await a.json()).code, "no_pin");
  }),
);

// -- olvidé mi PIN (punto 2)

test(
  "POST /api/security/pin/reset: con sesión de hace más de 10 minutos = 403 reauth_required y no toca nada",
  withApiEnv(async () => {
    const calls = installPool(pinWorld());
    const old = sessionAt(Date.now() - 11 * 60_000);
    const res = await pinReset(req("/api/security/pin/reset", "POST", { pin: GOOD_PIN }, old));
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, "reauth_required");
    assert.equal(calls.length, 0);
  }),
);

test(
  "POST /api/security/pin/reset: quien no tenía PIN recibe el primero al instante (204)",
  withApiEnv(async () => {
    const calls = installPool(pinWorld());
    const res = await pinReset(req("/api/security/pin/reset", "POST", { pin: GOOD_PIN }, sessionAt(Date.now() - 2 * 60_000)));
    assert.equal(res.status, 204);
    const now = queryOf(calls, T.createPin);
    assert.ok(now && !now.text.includes("where s.pin_hash is null"));
    assert.equal(await verifyPinHash(GOOD_PIN, SECRET_BYTES, { hash: now.values[1] as string, salt: now.values[2] as string }), true);
    assert.ok(has(calls, T.expire));
    assert.ok(!has(calls, T.pending));
  }),
);

test(
  "POST /api/security/pin/reset: con PIN el nuevo queda PENDIENTE 24 h (202) y el actual sigue valiendo",
  withApiEnv(async () => {
    const stored = await storedPin();
    const calls = installPool(pinWorld({ stored }));
    const res = await pinReset(req("/api/security/pin/reset", "POST", { pin: "135792" }, sessionAt(Date.now() - 60_000)));
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { pendingPinAt: "2026-10-10T12:00:00.000000Z" });
    const set = queryOf(calls, T.pending);
    assert.ok(set);
    assert.equal(set.values[3], PIN_RESET_DELAY_MS);
    assert.equal(PIN_RESET_DELAY_MS, 24 * 60 * 60 * 1000);
    assert.equal(await verifyPinHash("135792", SECRET_BYTES, { hash: set.values[1] as string, salt: set.values[2] as string }), true);
    // Nada reemplaza el PIN actual: ni el upsert inmediato, ni el cambio, ni el desbloqueo.
    assert.ok(!has(calls, T.createPin) && !has(calls, T.change));
    assert.ok(!calls.some((c) => c.text.startsWith("update public.payment_security set pin_hash")));
    assert.ok(!JSON.stringify(calls).includes("135792"));
  }),
);

test(
  "POST /api/security/pin/reset: si ya hay un reset pendiente no se pisa (409 reset_pending)",
  withApiEnv(async () => {
    const calls = installPool(pinWorld({ stored: await storedPin(), pendingAt: "2026-10-10T08:00:00.000000Z" }));
    const res = await pinReset(req("/api/security/pin/reset", "POST", { pin: "135792" }, sessionAt(Date.now() - 60_000)));
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "reset_pending");
    assert.equal(body.pendingPinAt, "2026-10-10T08:00:00.000000Z");
    assert.ok(!has(calls, T.pending));
    // PIN débil: rechazado aunque la sesión sea reciente.
    const weak = await pinReset(req("/api/security/pin/reset", "POST", { pin: "123456" }, sessionAt(Date.now())));
    assert.equal(weak.status, 400);
    assert.equal((await weak.json()).code, "weak_pin");
  }),
);

test(
  "DELETE /api/security/pin/reset: cancelar pide el PIN actual; con uno malo no cancela, con el bueno sí",
  withApiEnv(async () => {
    const stored = await storedPin();
    const calls = installPool(pinWorld({ stored, pendingAt: "2026-10-10T08:00:00.000000Z" }));
    const bad = await pinResetCancel(req("/api/security/pin/reset", "DELETE", { pin: "999111" }));
    assert.equal(bad.status, 422);
    assert.ok(!has(calls, T.cancel), "un PIN malo no cancela el reset");

    const noPin = await pinResetCancel(req("/api/security/pin/reset", "DELETE", {}));
    assert.equal(noPin.status, 400);

    const ok = await pinResetCancel(req("/api/security/pin/reset", "DELETE", { pin: GOOD_PIN }));
    assert.equal(ok.status, 204);
    assert.deepEqual(queryOf(calls, T.cancel)?.values, [aliceId]);
  }),
);

test(
  "reset pendiente que ya venció: se activa al leer el estado o al verificar el PIN, antes de reservar el intento",
  withApiEnv(async () => {
    const calls = installPool(pinWorld({ stored: await storedPin(), activates: true }));
    await securityGet(req("/api/security", "GET"));
    assert.ok(has(calls, T.activate));
    const activate = queryOf(calls, T.activate);
    assert.match(activate!.text, /pin_hash = s\.pending_pin_hash/);
    assert.match(activate!.text, /pin_version = s\.pin_version \+ 1/);
    assert.match(activate!.text, /s\.pending_pin_at <= now\(\)/);
    assert.match(activate!.text, /update public\.payment_approvals set expires_at = now\(\)/, "invalida los permisos pendientes en el mismo statement");
    assert.match(activate!.text, /failed_attempts = 0, lock_level = 0, locked_until = null/);
  }),
);

// -- límites

test(
  "PUT /api/security/limits: valida los límites antes de pedir el PIN y devuelve el estado nuevo",
  withApiEnv(async () => {
    const calls = installPool(pinWorld());
    for (const body of [{ pin: GOOD_PIN }, { USDC: 0, pin: GOOD_PIN }, { XLM: -5, pin: GOOD_PIN }, { USDC: 100001, pin: GOOD_PIN }, { USDC: "abc", pin: GOOD_PIN }]) {
      const res = await limitsPut(req("/api/security/limits", "PUT", body));
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal((await res.json()).code, "invalid_amount");
    }
    const noPin = await limitsPut(req("/api/security/limits", "PUT", { USDC: 50 }));
    assert.equal(noPin.status, 400);
    assert.equal((await noPin.json()).code, "invalid_pin");
    assert.equal(calls.length, 0);

    let limit = "100.0000000";
    const stored = await storedPin();
    const ok = installPool(
      pinWorld({
        stored,
        version: 5,
        extra: (text, values) => {
          if (text.startsWith(T.limits)) {
            limit = values[1] as string;
            return [{ profile_id: aliceId }];
          }
          if (text.startsWith(T.status)) {
            return [{ has_pin: true, locked_until: null, pending_pin_at: null, daily_limit_usdc: limit, daily_limit_xlm: "1000.0000000" }];
          }
          return undefined;
        },
      }),
    );
    const res = await limitsPut(req("/api/security/limits", "PUT", { USDC: 250.5, pin: GOOD_PIN }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).dailyLimit.USDC, 250.5);
    assert.deepEqual(queryOf(ok, T.limits)?.values, [aliceId, "250.5000000", null, 5], "con la versión del PIN verificado");
  }),
);

test(
  "PUT /api/security/limits: si el PIN cambió después de verificarlo = 409 pin_changed",
  withApiEnv(async () => {
    installPool(pinWorld({ stored: await storedPin(), versionMoved: true }));
    const res = await limitsPut(req("/api/security/limits", "PUT", { USDC: 50, pin: GOOD_PIN }));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, "pin_changed");
  }),
);

// -- approve

async function approveWorld(w: PinWorld = {}) {
  const stored = await storedPin();
  const bobProfile = { id: profileIdFromWallet(BOB), wallet: BOB, username: "bob", display_name: "Bob" };
  return installPool(
    pinWorld({
      stored,
      ...w,
      extra: (text, values) => {
        if (text.includes("from public.profiles p where lower(p.username)")) return values[0] === "bob" ? [bobProfile] : [];
        if (text.includes("from public.profiles p where p.wallet")) return values[0] === BOB ? [bobProfile] : [];
        return w.extra?.(text, values);
      },
    }),
  );
}

test(
  "POST /api/security/approve: @usuario con o sin @, PIN correcto -> 201 con el permiso de 5 minutos",
  withApiEnv(async () => {
    for (const to of ["@bob", "bob", "BOB"]) {
      const calls = await approveWorld({ version: 4 });
      const res = await approvePost(req("/api/security/approve", "POST", { to, asset: "USDC", amount: 5, pin: GOOD_PIN }));
      assert.equal(res.status, 201, to);
      assert.deepEqual(await res.json(), {
        id: APPROVAL_ID,
        toWallet: BOB,
        toLabel: "@bob",
        asset: "USDC",
        amount: 5,
        expiresAt: "2026-10-09T12:05:00.000000Z",
      });
      const insert = queryOf(calls, T.insertApproval);
      assert.deepEqual(insert?.values, [aliceId, BOB, "USDC", "5.0000000", 5 * 60_000, 4], "5 minutos y la versión del PIN verificado");
      assert.deepEqual(queryOf(calls, T.lockRow)?.values, [aliceId, 4], "la fila se bloquea exigiendo esa versión");
      assert.ok(calls.some((c) => c.text === "begin") && calls.some((c) => c.text === "commit"), "dentro de una transacción");
      resetApiLimits();
    }
    assert.equal(APPROVAL_TTL_MS, 5 * 60 * 1000);
  }),
);

test(
  "POST /api/security/approve: dirección G… (la de alguien con perfil se muestra como @usuario)",
  withApiEnv(async () => {
    await approveWorld();
    const res = await approvePost(req("/api/security/approve", "POST", { to: BOB.toLowerCase(), asset: "XLM", amount: "2,5", pin: GOOD_PIN }));
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.toWallet, BOB);
    assert.equal(body.toLabel, "@bob");
    assert.equal(body.amount, 2.5);
    const stranger = Keypair.random().publicKey();
    const res2 = await approvePost(req("/api/security/approve", "POST", { to: stranger, asset: "USDC", amount: 1, pin: GOOD_PIN }));
    assert.equal(res2.status, 201);
    assert.equal((await res2.json()).toLabel, `${stranger.slice(0, 4)}…${stranger.slice(-4)}`);
  }),
);

test(
  "POST /api/security/approve: destino y monto inválidos son 400 y no gastan intentos del PIN",
  withApiEnv(async () => {
    const calls = await approveWorld();
    const cases: [Record<string, unknown>, number, string][] = [
      [{ to: "nadie_existe", asset: "USDC", amount: 5, pin: GOOD_PIN }, 400, "invalid_recipient"],
      [{ to: "", asset: "USDC", amount: 5, pin: GOOD_PIN }, 400, "invalid_recipient"],
      [{ to: 12345, asset: "USDC", amount: 5, pin: GOOD_PIN }, 400, "invalid_recipient"],
      [{ to: ALICE, asset: "USDC", amount: 5, pin: GOOD_PIN }, 400, "invalid_recipient"],
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
    assert.ok(!has(calls, T.reserve));
    assert.ok(!has(calls, T.insertApproval));
  }),
);

test(
  "POST /api/security/approve: PIN incorrecto = 422 wrong_pin y no se crea ningún permiso",
  withApiEnv(async () => {
    const calls = await approveWorld({ failed: 4 });
    const res = await approvePost(req("/api/security/approve", "POST", { to: "bob", asset: "USDC", amount: 5, pin: "999111" }));
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.code, "wrong_pin");
    assert.equal(body.attemptsLeft, 1);
    assert.match(body.error, /queda 1 intento/);
    assert.ok(!has(calls, T.insertApproval));
  }),
);

test(
  "POST /api/security/approve: pasar el límite diario = 403 limit_exceeded con lo que queda",
  withApiEnv(async () => {
    const calls = await approveWorld({ spent: "90.0000000", limit: "100.0000000" });
    const res = await approvePost(req("/api/security/approve", "POST", { to: "bob", asset: "USDC", amount: 15, pin: GOOD_PIN }));
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, "limit_exceeded");
    assert.equal(body.remaining, 10);
    assert.ok(!has(calls, T.insertApproval));
    resetApiLimits();
    await approveWorld({ spent: "90.0000000", limit: "100.0000000" });
    const ok = await approvePost(req("/api/security/approve", "POST", { to: "bob", asset: "USDC", amount: 10, pin: GOOD_PIN }));
    assert.equal(ok.status, 201);
  }),
);

test(
  "límite diario: cuenta TODOS los permisos de las últimas 24 h, usados o no, vencidos o no (no se libera cupo)",
  () => {
    const spent = q.approvedLast24h("p");
    assert.match(spent.text, /a\.created_at > now\(\) - interval '24 hours'/);
    assert.ok(!spent.text.includes("used_at"), "no filtra por usados");
    assert.ok(!spent.text.includes("expires_at"), "no filtra por vigentes");
    assert.deepEqual(spent.values, ["p"]);
  },
);

test(
  "POST /api/security/approve: el PIN cambió entre verificarlo y crear el permiso = 409 pin_changed, sin permiso",
  withApiEnv(async () => {
    const calls = await approveWorld({ versionMoved: true });
    const res = await approvePost(req("/api/security/approve", "POST", { to: "bob", asset: "USDC", amount: 5, pin: GOOD_PIN }));
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, "pin_changed");
    assert.ok(!has(calls, T.insertApproval));
    assert.ok(calls.some((c) => c.text === "commit"), "la transacción se cierra sin dejar nada a medias");
  }),
);

test(
  "las rutas del PIN frenan por perfil: más de 10 pedidos por minuto = 429",
  withApiEnv(async () => {
    installPool(pinWorld());
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
    installPool(pinWorld());
    assert.equal((await pinPut(req("/api/security/pin", "PUT", { pin: GOOD_PIN }, null))).status, 401);
    const badType = new Request("https://kosmovia.test/api/security/pin", { method: "PUT", headers: { cookie: sessionAt(Date.now()), "content-type": "text/plain" }, body: "x" });
    assert.equal((await pinPut(badType)).status, 415);
    const arr = await pinPut(req("/api/security/pin", "PUT", [GOOD_PIN]));
    assert.equal(arr.status, 400);
    assert.equal((await approvePost(req("/api/security/approve", "POST", undefined))).status, 415);
  }),
);

// -- POST /api/payments con approvalId (puntos 5 y 7)

const HASH = "b".repeat(64);

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

const BY_OP = "where py.op_id = $1 and py.from_wallet = $2";

function paymentsPool(opts: { claimMatches: boolean; recorded?: boolean; raceLost?: boolean; failInsert?: boolean }) {
  return installPool((text) => {
    if (text.includes(BY_OP)) return opts.recorded || opts.raceLost ? [paymentRow(false)] : [];
    if (text.startsWith(T.claim)) return opts.claimMatches ? [{ id: APPROVAL_ID }] : [];
    if (text.startsWith(T.insertPayment)) {
      if (opts.failInsert) throw Object.assign(new Error("boom"), { code: "57P01" });
      return opts.raceLost ? [] : [paymentRow(!opts.claimMatches)];
    }
    return [];
  });
}

// Con `raceLost` la primera búsqueda por operación debe salir vacía y la segunda (tras el rollback) no.
function racePool() {
  let lookups = 0;
  return installPool((text) => {
    if (text.includes(BY_OP)) return ++lookups === 1 ? [] : [paymentRow(false)];
    if (text.startsWith(T.claim)) return [{ id: APPROVAL_ID }];
    if (text.startsWith(T.insertPayment)) return []; // on conflict do nothing: otra petición ganó
    return [];
  });
}

const postPayment = (body: Record<string, unknown>) =>
  withFakeHorizon(horizonOps(), () => paymentsPost(req("/api/payments", "POST", { hash: HASH, ...body })));

test(
  "POST /api/payments: el permiso que coincide se consume, se inserta y se liga en UNA transacción",
  withApiEnv(async () => {
    const calls = paymentsPool({ claimMatches: true });
    const res = await postPayment({ approvalId: APPROVAL_ID });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).payment.unverified, false);
    const claim = queryOf(calls, T.claim);
    assert.ok(claim);
    // perfil de la sesión, destino y monto de LO QUE VIO HORIZON (no del cuerpo)
    assert.deepEqual(claim.values.slice(0, 5), [APPROVAL_ID, aliceId, BOB, "USDC", "5.0000000"]);
    assert.equal(claim.values[6], APPROVAL_GRACE_MS);
    assert.deepEqual(queryOf(calls, T.insertPayment)?.values.slice(9), [APPROVAL_ID, false]);
    assert.deepEqual(queryOf(calls, T.link)?.values, [APPROVAL_ID, paymentRow(false).id]);
    const [begin, claimAt, insertAt, linkAt, commit] = [
      calls.findIndex((c) => c.text === "begin"),
      indexOf(calls, T.claim),
      indexOf(calls, T.insertPayment),
      indexOf(calls, T.link),
      calls.findIndex((c) => c.text === "commit"),
    ];
    assert.ok(begin >= 0 && begin < claimAt && claimAt < insertAt && insertAt < linkAt && linkAt < commit, "consumir + insertar + ligar entre begin y commit");
    assert.equal(new Set(calls.conn.slice(begin, commit + 1)).size, 1, "misma conexión");
  }),
);

test(
  "POST /api/payments: primero la idempotencia: una operación ya registrada se devuelve sin tocar el permiso",
  withApiEnv(async () => {
    const calls = paymentsPool({ claimMatches: true, recorded: true });
    const res = await postPayment({ approvalId: APPROVAL_ID });
    assert.equal(res.status, 200);
    assert.ok(!has(calls, T.claim) && !has(calls, T.insertPayment), "ni consume ni inserta");
    assert.ok(!calls.some((c) => c.text === "begin"));
  }),
);

test(
  "POST /api/payments: permiso que no coincide (monto, destino, vencido, usado, versión) se guarda igual como unverified",
  withApiEnv(async () => {
    const calls = paymentsPool({ claimMatches: false });
    const res = await postPayment({ approvalId: APPROVAL_ID });
    assert.equal(res.status, 201, "nunca se rechaza el registro: el dinero ya se movió");
    assert.equal((await res.json()).payment.unverified, true);
    assert.deepEqual(queryOf(calls, T.insertPayment)?.values.slice(9), [null, true]);
    assert.ok(!has(calls, T.link));
  }),
);

test(
  "POST /api/payments: sin approvalId o con uno inválido también se guarda, unverified, y ni se intenta consumir",
  withApiEnv(async () => {
    for (const body of [{}, { approvalId: 5 }, { approvalId: "no-es-uuid" }, { approvalId: null }]) {
      const calls = paymentsPool({ claimMatches: false });
      const res = await postPayment(body);
      assert.equal(res.status, 201, JSON.stringify(body));
      assert.deepEqual(queryOf(calls, T.insertPayment)?.values.slice(9), [null, true]);
      assert.ok(!has(calls, T.claim), JSON.stringify(body));
      resetApiLimits();
    }
  }),
);

test(
  "POST /api/payments: si otra petición registró la operación en paralelo, todo se deshace (rollback) y se devuelve el pago existente",
  withApiEnv(async () => {
    const calls = racePool();
    const res = await postPayment({ approvalId: APPROVAL_ID });
    assert.equal(res.status, 200);
    assert.ok(calls.some((c) => c.text === "rollback"), "el permiso consumido se deshace con la transacción");
    assert.ok(!calls.some((c) => c.text === "commit"));
    assert.ok(!has(calls, T.link));
    assert.ok(!calls.some((c) => c.text.includes("set used_at = null")), "no hay 'liberación' manual del permiso");
  }),
);

test(
  "POST /api/payments: un error al guardar deshace la transacción y NO libera el permiso a mano",
  withApiEnv(async () => {
    const calls = paymentsPool({ claimMatches: true, failInsert: true });
    const res = await postPayment({ approvalId: APPROVAL_ID });
    assert.equal(res.status, 500);
    assert.ok(calls.some((c) => c.text === "rollback"));
    assert.ok(!calls.some((c) => c.text.includes("set used_at = null")), "un error de transporte ambiguo no libera nada");
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
