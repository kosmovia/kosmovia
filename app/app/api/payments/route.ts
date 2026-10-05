import { failure, handled, json, readJsonBody, requireGate, type Session } from "../../../lib/core/api-route.ts";
import { limitedResponse } from "../../../lib/core/api-limits.ts";
import * as repo from "../../../lib/core/db/repo.ts";
import {
  MEMO_RE,
  TX_HASH_RE,
  attemptDeadlineMs,
  cleanNote,
  fetchAccountPayments,
  fetchHistoryClosedAt,
  fetchTxOperations,
  historyReaches,
  memoCandidates,
  pickPayment,
  type VerifiedPayment,
} from "../../../lib/core/payments.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/payments (api backend)
 *
 * The payments the session's wallet sent or received, newest first, with both
 * sides' public profiles. -> { payments: PaymentWire[] }
 */
export async function GET(request: Request): Promise<Response> {
  const g = requireGate(request);
  if (!g.ok) return g.response;
  const limited = limitedResponse("paymentRead", g.session.profileId);
  if (limited) return limited;
  return handled("GET /api/payments", async () => json({ payments: await repo.listPayments(g.session.wallet) }));
}

/**
 * POST /api/payments { hash?, memo?, startedAt?, note? } (api backend)
 *
 * Records a payment the user just sent with Pollar. Nothing the body says
 * about the money is trusted: the server reads it on Horizon testnet and
 * records it only if it is one successful XLM/USDC payment whose sender is
 * the session's wallet, made in the last 24 hours.
 *
 * - With `hash`: that transaction.
 * - With only `memo` (the send's outcome was unknown: no hash came back): the
 *   wallet's own payments carrying that memo. `startedAt` lets the server say
 *   "none" for sure once Horizon's history is past that attempt's deadline;
 *   it only decides whether the person may send again, never what is recorded.
 *
 * -> 201 { payment } | 200 { payment } (already recorded)
 *    202 { pending: true } (not on Horizon yet, or can't tell)
 *    404 { code: "not_found" } (searched past the deadline: it never landed)
 */
export async function POST(request: Request): Promise<Response> {
  const g = requireGate(request);
  if (!g.ok) return g.response;
  const limited = limitedResponse("paymentRecord", g.session.profileId);
  if (limited) return limited;

  const body = await readJsonBody(request, 2_048);
  if (!body.ok) return body.response;
  const input = (body.value ?? {}) as { hash?: unknown; memo?: unknown; startedAt?: unknown; note?: unknown };
  const hash = typeof input.hash === "string" ? input.hash.trim().toLowerCase() : "";
  const memo = typeof input.memo === "string" ? input.memo.trim() : "";
  if (hash && !TX_HASH_RE.test(hash)) return failure(400, "El hash de la transacción no es válido.", "invalid_hash");
  if (!hash && !MEMO_RE.test(memo)) return failure(400, "Falta el hash o la referencia del pago.", "invalid_hash");
  const note = cleanNote(input.note);

  if (hash) {
    const lookup = await fetchTxOperations(hash);
    if ("error" in lookup) return horizonDown(lookup.error);
    if (!lookup.found) return json({ pending: true }, 202);
    const verified = pickPayment(lookup.ops, g.session.wallet);
    if (!verified.ok) return failure(verified.status, verified.error, verified.code);
    return save(g.session, verified.payment, note);
  }

  // By memo. The watermark is read BEFORE the search, so it never vouches for history the search didn't see.
  const closedAt = await fetchHistoryClosedAt();
  const page = await fetchAccountPayments(g.session.wallet);
  if (!page.ok) return json({ pending: true }, 202);
  let unsure = false;
  for (const candidate of memoCandidates(page.records, g.session.wallet, memo)) {
    const lookup = await fetchTxOperations(candidate);
    if (!("found" in lookup) || !lookup.found) {
      unsure = true;
      continue;
    }
    const verified = pickPayment(lookup.ops, g.session.wallet);
    if (verified.ok) return save(g.session, verified.payment, note);
  }
  const startedAt = typeof input.startedAt === "string" ? Date.parse(input.startedAt) : NaN;
  // 200 results is the page: a wallet that sent more than that since this attempt can't be searched to the end.
  const full = page.records.length >= 200;
  if (!unsure && !full && Number.isFinite(startedAt) && historyReaches(closedAt, attemptDeadlineMs(startedAt))) {
    return failure(404, "Ese pago no llegó a la red. No se movió dinero.", "not_found");
  }
  return json({ pending: true }, 202);
}

function horizonDown(code: string): Response {
  console.error(`api.error route=POST /api/payments code=${code}`);
  return failure(502, "No pudimos consultar la red de Stellar. Intenta de nuevo en unos segundos.", "horizon_error");
}

function save(session: Session, p: VerifiedPayment, note: string | null): Promise<Response> {
  return handled("POST /api/payments", async () => {
    const outcome = await repo.recordPayment({
      opId: p.opId,
      txHash: p.txHash,
      fromWallet: session.wallet,
      toWallet: p.to,
      asset: p.asset,
      amount: p.amount,
      note,
      registeredBy: session.profileId,
      paidAt: p.createdAt,
    });
    if (outcome.status === "conflict") return failure(409, "Ese pago ya está registrado.", "payment_exists");
    return json({ payment: outcome.payment }, outcome.status === "created" ? 201 : 200);
  });
}
