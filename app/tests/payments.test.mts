import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-ignore: Node necesita la extensión .ts al importar; Next la resuelve sin ella.
import {
  MEMO_RE,
  PAYMENT_MAX_AGE_MS,
  SEND_TIMEOUT_SEC,
  attemptDeadlineMs,
  checkAmount,
  classifySubmit,
  classifyWithPhase,
  cleanNote,
  fetchTxOperations,
  fromStroops,
  historyReaches,
  memoCandidates,
  newPaymentRef,
  paymentOptions,
  pickPayment,
  rejectionMessage,
  rejectionText,
  rejectionReason,
  toStroops,
  trimAmount,
} from "../lib/core/payments.ts";
// @ts-ignore
import { claimFailure, pickWelcomeRule } from "../lib/core/welcome.ts";
// @ts-ignore
import * as q from "../lib/core/db/sql.ts";
// @ts-ignore
import { USDC_ISSUER_TESTNET } from "../lib/core/pollar-config.ts";

const ME = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const YOU = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const HASH = "a".repeat(64);
const NOW = Date.parse("2026-10-04T12:00:00Z");

const op = (over: Record<string, unknown> = {}) => ({
  id: "123456789",
  type: "payment",
  transaction_successful: true,
  transaction_hash: HASH,
  created_at: "2026-10-04T11:59:00Z",
  from: ME,
  to: YOU,
  asset_type: "credit_alphanum4",
  asset_code: "USDC",
  asset_issuer: USDC_ISSUER_TESTNET,
  amount: "5.0000000",
  ...over,
});

test("los montos se manejan como stroops, sin floats", () => {
  assert.equal(toStroops("1.5"), BigInt(15_000_000));
  assert.equal(toStroops("0.0000001"), BigInt(1));
  assert.equal(toStroops("1.12345678"), null);
  assert.equal(toStroops("-1"), null);
  assert.equal(toStroops("1e3"), null);
  assert.equal(fromStroops(BigInt(15_000_000)), "1.5000000");
  assert.equal(trimAmount("5.0000000"), "5");
  assert.equal(trimAmount("0.2500000"), "0.25");
});

test("checkAmount: coma decimal, mayor que 0, tope y saldo", () => {
  assert.deepEqual(checkAmount("2,5", "USDC"), { ok: true, amount: "2.5000000" });
  assert.equal(checkAmount("", "USDC").ok, false);
  assert.equal(checkAmount("0", "USDC").ok, false);
  assert.equal(checkAmount("0,009", "USDC").ok, false, "el mínimo es 0,01");
  assert.match((checkAmount("0.001", "XLM") as { error: string }).error, /mínimo por envío es 0,01 XLM/);
  assert.deepEqual(checkAmount("0,01", "USDC"), { ok: true, amount: "0.0100000" });
  assert.equal(checkAmount("abc", "XLM").ok, false);
  assert.equal(checkAmount("10000.0000001", "XLM").ok, false);
  assert.equal(checkAmount("10000", "XLM").ok, true);
  const short = checkAmount("6", "USDC", "5.0000000");
  assert.equal(short.ok, false);
  assert.match((short as { error: string }).error, /tienes 5 USDC/);
  assert.equal(checkAmount("5", "USDC", "5.0000000").ok, true);
});

test("cleanNote quita caracteres de control y recorta a 140", () => {
  assert.equal(cleanNote("  hola\u0000mundo  "), "hola mundo");
  assert.equal(cleanNote("   "), null);
  assert.equal(cleanNote(42), null);
  assert.equal(cleanNote("x".repeat(500))?.length, 140);
});

test("pickPayment acepta un pago de USDC o XLM de tu wallet", () => {
  const usdc = pickPayment([op()], ME, NOW);
  assert.ok(usdc.ok);
  assert.deepEqual(usdc.payment, {
    opId: "123456789",
    txHash: HASH,
    from: ME,
    to: YOU,
    asset: "USDC",
    amount: "5.0000000",
    createdAt: "2026-10-04T11:59:00.000Z",
    memo: null,
  });
  const xlm = pickPayment([op({ asset_type: "native", asset_code: undefined, asset_issuer: undefined })], ME, NOW);
  assert.ok(xlm.ok && xlm.payment.asset === "XLM");
});

test("pickPayment lee el memo de texto de la transacción (la referencia que ata el permiso del PIN)", () => {
  const memo = (transaction: unknown) => {
    const r = pickPayment([op({ transaction })], ME, NOW);
    return r.ok ? r.payment.memo : "no-ok";
  };
  assert.equal(memo({ memo_type: "text", memo: "kv-abcdefghijklmnop" }), "kv-abcdefghijklmnop");
  assert.equal(memo({ memo_type: "text", memo: " kv-abcdefghijklmnop " }), "kv-abcdefghijklmnop");
  assert.equal(memo({ memo_type: "id", memo: "123" }), null, "un memo que no es de texto no es una referencia");
  assert.equal(memo({ memo_type: "none" }), null);
  assert.equal(memo(undefined), null);
});

test("fetchTxOperations pide las operaciones con su transacción (join=transactions) para leer el memo", async () => {
  let url = "";
  const fake = (async (input: string) => {
    url = String(input);
    return new Response(JSON.stringify({ _embedded: { records: [] } }), { status: 200 });
  }) as unknown as typeof fetch;
  await fetchTxOperations(HASH, fake);
  assert.match(url, /\/transactions\/[0-9a-f]{64}\/operations\?limit=20&join=transactions$/);
});

test("pickPayment rechaza lo que no se puede reclamar", () => {
  const code = (ops: unknown[], wallet = ME) => {
    const r = pickPayment(ops as never, wallet, NOW);
    return r.ok ? "ok" : r.code;
  };
  assert.equal(code([]), "not_a_payment");
  assert.equal(code([op({ type: "create_account" })]), "not_a_payment");
  assert.equal(code([op()], YOU), "not_your_payment");
  assert.equal(code([op({ transaction_successful: false })]), "tx_failed");
  assert.equal(code([op(), op({ id: "2" })]), "many_payments");
  assert.equal(code([op({ asset_issuer: YOU })]), "asset_not_supported");
  assert.equal(code([op({ asset_code: "EURC" })]), "asset_not_supported");
  assert.equal(code([op({ to: ME })]), "self_payment");
  assert.equal(code([op({ to: "not-an-address" })]), "bad_payment");
  assert.equal(code([op({ amount: "0.0000000" })]), "bad_payment");
  assert.equal(code([op({ created_at: new Date(NOW - PAYMENT_MAX_AGE_MS - 1000).toISOString() })]), "too_old");
  assert.equal(code([op({ id: "1; drop table" })]), "bad_payment");
});

test("un error sin hash es 'desconocido': nunca se trata como 'no se envió'", () => {
  assert.equal(classifySubmit({ status: "success", hash: HASH }), "sent");
  assert.equal(classifySubmit({ status: "error", hash: HASH, code: "TX_FAILED" }), "sent");
  assert.equal(classifySubmit(undefined), "unknown");
  assert.equal(classifySubmit({ status: "error" }), "unknown");
  assert.equal(classifySubmit({ status: "error", code: "TX_BAD_SEQUENCE" }), "unknown");
  assert.equal(classifySubmit({ status: "error", details: "Request timed out" }), "unknown");
  assert.equal(classifySubmit({ status: "pending" }), "unknown");
  assert.equal(classifySubmit({ status: "error", code: "TX_INSUFFICIENT_BALANCE" }), "rejected");
  assert.equal(rejectionReason({ status: "error", code: "TX_NO_TRUSTLINE" }), "destination");
  // La wallet de Pollar no terminó de crearse: nada se armó ni se firmó.
  assert.equal(classifySubmit({ status: "error", code: "SDK_WALLET_NOT_READY" }), "rejected");
  assert.match(rejectionMessage("notReady"), /Sal y vuelve a entrar/);
  // Pollar no firmó (activo no habilitado): rechazo inmediato, con su motivo.
  const signFailed = { status: "error", code: "TX_SIGN_FAILED", details: "Asset USDC is not enabled for this application." };
  assert.equal(classifySubmit(signFailed), "rejected");
  assert.match(rejectionText("signFailed", signFailed), /no se envió nada.*not enabled/);
  assert.equal(rejectionReason({ status: "error", details: "User declined access" }), "declined");
  assert.equal(rejectionReason({ status: "error", details: "No wallet connected" }), "noWallet");
  // Only the whole message counts, never a substring.
  assert.equal(rejectionReason({ status: "error", details: "timeout after User declined access was shown" }), null);
  assert.match(rejectionMessage("declined"), /no se envió nada/);
  assert.match(rejectionMessage("balance"), /XLM para la comisión/);
});

test("cada envío lleva una referencia única y una vida acotada", () => {
  const refs = new Set(Array.from({ length: 200 }, () => newPaymentRef()));
  assert.equal(refs.size, 200);
  for (const r of refs) assert.match(r, MEMO_RE);
  assert.ok(newPaymentRef().length <= 28, "un memo de texto de Stellar tiene 28 bytes como máximo");
  assert.deepEqual(paymentOptions("kv-abcdefghijklmnop"), { memo: { type: "text", value: "kv-abcdefghijklmnop" }, timeoutSec: SEND_TIMEOUT_SEC });
  const start = Date.parse("2026-10-04T12:00:00Z");
  assert.equal(attemptDeadlineMs(start), start + SEND_TIMEOUT_SEC * 1000 + 2 * 60 * 1000);
});

test("buscar por memo: solo pagos que salieron de tu wallet, una vez cada uno", () => {
  const memo = "kv-abcdefghijklmnop";
  const rec = (over: Record<string, unknown>) => ({
    type: "payment", from: ME, to: YOU, transaction_hash: HASH, transaction: { memo_type: "text", memo }, ...over,
  });
  const other = "b".repeat(64);
  assert.deepEqual(
    memoCandidates(
      [
        rec({ from: YOU, to: ME, transaction_hash: other }), // alguien te manda un pago con tu memo: no se cree
        rec({}),
        rec({}), // la misma tx vista dos veces
        rec({ transaction: { memo_type: "text", memo: "kv-otro" } }),
        rec({ type: "create_account" }),
        rec({ transaction_hash: "no-es-un-hash" }),
      ] as never,
      ME,
      memo,
    ),
    [HASH],
  );
});

test("una búsqueda vacía solo vale si la red ya pasó el plazo del intento", () => {
  const deadline = Date.parse("2026-10-04T12:07:00Z");
  assert.equal(historyReaches(null, deadline), false);
  assert.equal(historyReaches(deadline, deadline), false);
  assert.equal(historyReaches(deadline - 1, deadline), false);
  assert.equal(historyReaches(deadline + 5_000, deadline), true);
});

test("el regalo de bienvenida ofrece USDC primero y entiende los errores", () => {
  const rules = [
    { id: "1", assetCode: "XLM", amount: "5", claimable: true },
    { id: "2", assetCode: "USDC", amount: "1", claimable: false },
    { id: "3", assetCode: "USDC", amount: "0.5", claimable: true },
  ];
  assert.equal(pickWelcomeRule(rules)?.id, "3");
  assert.equal(pickWelcomeRule([rules[1]]), null);
  assert.equal(claimFailure(new Error("DISTRIBUTION_RATE_LIMIT_EXCEEDED")), "claimed");
  assert.equal(claimFailure(new Error("DISTRIBUTION_RULE_EXHAUSTED")), "gone");
  assert.equal(claimFailure(new Error("network")), "retry");
});

test("las consultas de pagos van parametrizadas", () => {
  const hostile = "x'; drop table payments; --";
  const ins = q.insertPayment({
    opId: hostile, txHash: hostile, fromWallet: hostile, toWallet: hostile, asset: "USDC",
    amount: "1.0000000", note: hostile, registeredBy: hostile, paidAt: "2026-10-04T00:00:00Z",
  });
  assert.ok(!ins.text.includes("drop table"));
  assert.match(ins.text, /on conflict \(op_id\) do nothing/);
  assert.equal(ins.values.length, 12);
  for (const query of [q.paymentByOpForSender(hostile, hostile), q.paymentsOfWallet(hostile, 50)]) {
    assert.ok(!query.text.includes("drop table"));
  }
});

test("buscar un perfil por wallet va parametrizado", () => {
  const query = q.profileByWallet("x'; drop table profiles; --");
  assert.match(query.text, /where p\.wallet = \$1/);
  assert.ok(!query.text.includes("drop table"));
});

test("0004_pagos.sql: un pago por operación y CHECKs de formato", () => {
  const sql = readFileSync(new URL("../db/migrations/0004_pagos.sql", import.meta.url), "utf8");
  assert.match(sql, /constraint payments_op_id_key unique \(op_id\)/);
  assert.match(sql, /payments_not_self check \(from_wallet <> to_wallet\)/);
  assert.match(sql, /asset in \('XLM', 'USDC'\)/);
  assert.match(sql, /amount > 0/);
  assert.match(sql, /char_length\(note\) between 1 and 140/);
});

test("un fallo al armar o firmar (antes de enviar) se muestra al instante", () => {
  const err = { status: "error", details: "algo raro" };
  assert.equal(classifyWithPhase(err, { step: "error", phase: "building" }), "rejected");
  assert.equal(classifyWithPhase(err, { step: "error", phase: "signing" }), "rejected");
  // Enviando o en una llamada atómica: puede haber salido.
  assert.equal(classifyWithPhase(err, { step: "error", phase: "submitting" }), "unknown");
  assert.equal(classifyWithPhase(err, { step: "error", phase: "signing-submitting" }), "unknown");
  assert.equal(classifyWithPhase(err, { step: "error", phase: "building-signing-submitting" }), "unknown");
  assert.equal(classifyWithPhase(err, null), "unknown");
  // Con hash siempre es "sent", aunque el estado diga error.
  assert.equal(classifyWithPhase({ status: "error", hash: HASH }, { step: "error", phase: "building" }), "sent");
});
