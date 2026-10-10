/**
 * Reglas del cobro B2B: qué cuenta como cobro y quién puede pagarlo.
 * El "una sola vez" lo garantiza el índice único de la 0018; acá se prueba que
 * el motivo que se devuelve sea el correcto.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { canPayInvoice, parseInvoice, PREFIX, type PayContext } from "../lib/core/invoice-rules.ts";

const AUTOR = "11111111-1111-4111-8111-111111111111";
const PAGADOR = "22222222-2222-4222-8222-222222222222";
const TERCERO = "33333333-3333-4333-8333-333333333333";

const cobro = (extra: Record<string, unknown> = {}) =>
  `${PREFIX}${JSON.stringify({ amount: 75, concept: "Factura #205", ...extra })}]`;

const ctx = (over: Partial<PayContext> = {}): PayContext => ({
  content: cobro(),
  authorId: AUTOR,
  payerId: PAGADOR,
  role: "member",
  visibility: "public",
  alreadyPaid: false,
  ...over,
});

// ------------------------------------------------------------------ parseInvoice

test("parseInvoice lee monto, concepto y destinatario", () => {
  assert.deepEqual(parseInvoice(cobro()), { amount: 75, concept: "Factura #205", payerId: null });
  assert.deepEqual(parseInvoice(cobro({ payerId: PAGADOR })), {
    amount: 75,
    concept: "Factura #205",
    payerId: PAGADOR,
  });
});

test("parseInvoice acepta corchetes en el concepto (el JSON va hasta el último ])", () => {
  const c = `${PREFIX}${JSON.stringify({ amount: 10, concept: "Factura [205] final" })}]`;
  assert.equal(parseInvoice(c)?.concept, "Factura [205] final");
});

test("parseInvoice rechaza lo que no es un cobro válido", () => {
  assert.equal(parseInvoice("hola"), null);
  assert.equal(parseInvoice(`${PREFIX}no es json]`), null);
  assert.equal(parseInvoice(PREFIX), null);
  // Monto ausente, cero, negativo o no numérico.
  assert.equal(parseInvoice(`${PREFIX}{"concept":"x"}]`), null);
  assert.equal(parseInvoice(cobro({ amount: 0 })), null);
  assert.equal(parseInvoice(`${PREFIX}{"amount":-5,"concept":"x"}]`), null);
  assert.equal(parseInvoice(`${PREFIX}{"amount":"75","concept":"x"}]`), null);
  assert.equal(parseInvoice(`${PREFIX}{"amount":75}]`), null);
});

test("un payerId que no es UUID se ignora: el cobro queda abierto, no dirigido a basura", () => {
  assert.equal(parseInvoice(cobro({ payerId: "cualquiera" }))?.payerId, null);
  assert.equal(parseInvoice(cobro({ payerId: 42 }))?.payerId, null);
});

// ------------------------------------------------------------------ canPayInvoice

test("un miembro puede pagar un cobro abierto", () => {
  assert.deepEqual(canPayInvoice(ctx()), { allowed: true });
});

test("el destinatario puede pagar el cobro dirigido a él", () => {
  assert.deepEqual(canPayInvoice(ctx({ content: cobro({ payerId: PAGADOR }) })), { allowed: true });
});

test("otro miembro NO puede pagar un cobro dirigido a alguien más", () => {
  const d = canPayInvoice(ctx({ content: cobro({ payerId: TERCERO }) }));
  assert.equal(d.allowed, false);
  assert.equal(d.allowed === false && d.status, 403);
  assert.equal(d.allowed === false && d.code, "not_the_payer");
});

test("el autor no puede pagarse a sí mismo", () => {
  const d = canPayInvoice(ctx({ payerId: AUTOR }));
  assert.equal(d.allowed === false && d.code, "own_invoice");
  assert.equal(d.allowed === false && d.status, 403);
});

test("un cobro ya pagado da 409 y gana sobre el resto de los motivos", () => {
  const d = canPayInvoice(ctx({ alreadyPaid: true }));
  assert.equal(d.allowed === false && d.status, 409);
  assert.equal(d.allowed === false && d.code, "invoice_paid");
});

test("quien no es miembro no puede pagar", () => {
  const d = canPayInvoice(ctx({ role: null }));
  assert.equal(d.allowed === false && d.code, "not_member");
});

test("en un canal privado, un miembro común no puede pagar", () => {
  const d = canPayInvoice(ctx({ visibility: "private" }));
  assert.equal(d.allowed === false && d.code, "private_channel");
  // Pero el moderador del canal privado sí.
  assert.deepEqual(canPayInvoice(ctx({ visibility: "private", role: "moderator" })), { allowed: true });
});

test("un mensaje que no es cobro no se puede pagar", () => {
  const d = canPayInvoice(ctx({ content: "hola" }));
  assert.equal(d.allowed === false && d.status, 400);
  assert.equal(d.allowed === false && d.code, "not_an_invoice");
});

test("el permiso se evalúa antes que el estado: un no miembro no se entera de si ya se pagó", () => {
  const d = canPayInvoice(ctx({ role: null, alreadyPaid: true }));
  assert.equal(d.allowed === false && d.code, "not_member");
});
