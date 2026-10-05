"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { usePollar } from "@pollar/react";
import { Avatar } from "./Avatar";
import { apiRequest } from "../lib/api-client.ts";
import { isApiBackend } from "../lib/backend.ts";
import type { ProfileRow } from "../lib/mappers.ts";
import { fetchBalances, shortAddress, type AccountBalances } from "../lib/pollar-horizon.ts";
import {
  ADDRESS_RE,
  NOTE_MAX,
  PAYMENT_ASSETS,
  attemptDeadlineMs,
  checkAmount,
  classifyWithPhase,
  explorerTxUrl,
  newPaymentRef,
  paymentOptions,
  pollarAsset,
  rejectionText,
  rejectionReason,
  trimAmount,
  type PaymentAsset,
} from "../lib/payments.ts";
import { forgetPayment, recallPayment, rememberPayment, type InFlightPayment } from "../lib/payment-memory.ts";
import { USERNAME_RE } from "../lib/validation.ts";
import type { RecordInput, RecordResult } from "../hooks/usePayments.ts";

/** Who the money goes to: a Kosmovia profile or a bare Stellar address. */
type Recipient =
  | { kind: "profile"; wallet: string; username: string; displayName: string; avatarSeed: string | null; avatarStyle: string | null }
  | { kind: "address"; wallet: string };

type Lookup =
  | { step: "idle" }
  | { step: "searching" }
  | { step: "found"; recipient: Recipient }
  | { step: "error"; message: string };

type Stage =
  | { step: "form" }
  | { step: "checking" }
  | { step: "review"; recipient: Recipient; amount: string }
  | { step: "sending"; recipient: Recipient; flight: InFlightPayment }
  /** Money may be in flight: only verify, never send again. */
  | { step: "verifying"; recipient: Recipient | null; flight: InFlightPayment; hash?: string; detail?: string }
  | { step: "done"; recipient: Recipient | null; flight: InFlightPayment; hash: string; warning: string | null };

/** Quick amounts. The minimum is 0.01; tests and demos use 0.01-0.02 USDC per payment. */
const QUICK: Record<PaymentAsset, string[]> = { USDC: ["0.01", "0.02", "0.1", "1"], XLM: ["1", "5", "10"] };
const DEFAULT_AMOUNT = "0,02";

export interface SendPaymentProps {
  /** The sender's wallet (the session's). */
  address: string;
  balances: AccountBalances | null;
  record: (input: RecordInput) => Promise<RecordResult>;
  /** Called after a payment leaves the wallet, to refresh balances. */
  onSent?: () => void;
  /** Prefill from a payment link (/pagar/@usuario?monto=5&activo=USDC). */
  preset?: { to?: string; amount?: string; asset?: PaymentAsset };
}

/** "@Nova_Pilot" -> "nova_pilot"; a G-address is kept as is (upper case). */
function normalizeRecipient(raw: string): { kind: "address"; wallet: string } | { kind: "username"; username: string } | null {
  const value = raw.trim();
  if (ADDRESS_RE.test(value.toUpperCase()) && value.length === 56) return { kind: "address", wallet: value.toUpperCase() };
  const username = value.replace(/^@/, "").toLowerCase();
  return USERNAME_RE.test(username) ? { kind: "username", username } : null;
}

function recipientLabel(r: Recipient): string {
  return r.kind === "profile" ? `@${r.username}` : shortAddress(r.wallet);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Send USDC or XLM to a @username (or a G-address) with Pollar, then record it
 * on our server. The send can't go out twice (pattern from Pollar Pass): it
 * carries a unique memo and a 5-minute lifetime, is remembered before the SDK
 * is called, and an outcome without a hash is looked up by memo until it is
 * found or provably never landed.
 */
export function SendPayment({ address, balances, record, onSent, preset }: SendPaymentProps) {
  const { sendPayment, getClient } = usePollar();
  const toId = useId();
  const amountId = useId();
  const noteId = useId();
  const [to, setTo] = useState(preset?.to ?? "");
  const [asset, setAsset] = useState<PaymentAsset>(preset?.asset ?? "USDC");
  const [amount, setAmount] = useState(preset?.amount ?? DEFAULT_AMOUNT);
  const [note, setNote] = useState("");
  const [lookup, setLookup] = useState<Lookup>({ step: "idle" });
  const [stage, setStage] = useState<Stage>({ step: "form" });
  const [formError, setFormError] = useState<string | null>(null);
  const recordRef = useRef(record);
  recordRef.current = record;
  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;

  // A send left in flight (reload, closed tab): resume verifying it, never offer to send again.
  useEffect(() => {
    const flight = recallPayment(address);
    if (flight) setStage({ step: "verifying", recipient: null, flight });
  }, [address]);

  // Resolve the recipient as the user types (debounced).
  useEffect(() => {
    const parsed = normalizeRecipient(to);
    if (!to.trim()) return setLookup({ step: "idle" });
    if (!parsed) return setLookup({ step: "error", message: "Escribe un @usuario o una dirección G… de Stellar." });
    if (parsed.kind === "address" && parsed.wallet === address) {
      return setLookup({ step: "error", message: "Esa es tu propia wallet." });
    }
    if (parsed.kind === "address" && !isApiBackend()) {
      return setLookup({ step: "found", recipient: { kind: "address", wallet: parsed.wallet } });
    }
    if (!isApiBackend()) return setLookup({ step: "error", message: "Buscar por @usuario necesita el servidor de Kosmovia." });
    setLookup({ step: "searching" });
    let cancelled = false;
    const timer = setTimeout(async () => {
      // Una dirección G... también se busca: si es de alguien de Kosmovia, se ve quién es.
      const key = parsed.kind === "address" ? parsed.wallet : parsed.username;
      const res = await apiRequest<{ profile: ProfileRow }>(`/api/profiles/${encodeURIComponent(key)}`);
      if (cancelled) return;
      if (!res.ok && parsed.kind === "address") {
        setLookup({ step: "found", recipient: { kind: "address", wallet: parsed.wallet } });
        return;
      }
      if (!res.ok) {
        setLookup({ step: "error", message: res.status === 404 ? `No existe @${key}.` : res.error });
        return;
      }
      const p = res.data.profile;
      if (p.wallet === address) return setLookup({ step: "error", message: "Ese eres tú." });
      setLookup({
        step: "found",
        recipient: {
          kind: "profile",
          wallet: p.wallet,
          username: p.username,
          displayName: p.display_name || `@${p.username}`,
          avatarSeed: p.avatar_seed,
          avatarStyle: p.avatar_style,
        },
      });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [to, address]);

  // Verify a payment that may be in flight until it is recorded, or provably never landed.
  const verifying = stage.step === "verifying" ? stage : null;
  useEffect(() => {
    if (!verifying) return;
    const { flight, hash, recipient } = verifying;
    let cancelled = false;
    void (async () => {
      const deadline = attemptDeadlineMs(Date.parse(flight.startedAt));
      let delay = 2_000;
      while (!cancelled) {
        // Past the deadline a hash Horizon never saw is searched by memo, which can say "never landed".
        const useHash = hash && Date.now() < deadline ? hash : undefined;
        const res = await recordRef.current({ hash: useHash, memo: flight.memo, startedAt: flight.startedAt, note: flight.note });
        if (cancelled) return;
        if (res.kind === "recorded") {
          forgetPayment(address);
          onSentRef.current?.();
          setStage({ step: "done", recipient, flight, hash: res.payment.tx_hash, warning: null });
          return;
        }
        if (res.kind === "never_landed" || res.kind === "failed") {
          forgetPayment(address);
          setStage({ step: "form" });
          setFormError(res.kind === "never_landed" ? "Ese pago no llegó a la red. No se movió dinero; puedes intentarlo de nuevo." : res.error);
          return;
        }
        await wait(delay);
        delay = Math.min(delay * 1.5, 10_000);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [verifying, address]);

  const balance = balances?.exists ? (asset === "XLM" ? balances.xlm : balances.usdc) : null;
  const amountCheck = amount.trim() ? checkAmount(amount, asset, balance) : null;

  const onReview = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (lookup.step !== "found") return setFormError("Elige a quién le envías.");
    if (balances && !balances.exists) {
      return setFormError("Tu cuenta todavía no está activa en la red de prueba. Pulsa “Recargar XLM de prueba” más abajo.");
    }
    const checked = checkAmount(amount, asset, balance);
    if (!checked.ok) return setFormError(checked.error);
    if (asset === "USDC" && balances?.exists && balances.usdc === null) {
      return setFormError("Tu wallet todavía no tiene USDC habilitado. Envía XLM o espera a que termine de activarse.");
    }
    // The network rejects a payment the recipient can't receive: check first, in words.
    setStage({ step: "checking" });
    try {
      const theirs = await fetchBalances(lookup.recipient.wallet);
      if (!theirs.exists) {
        setStage({ step: "form" });
        return setFormError(`${recipientLabel(lookup.recipient)} todavía no tiene la wallet activa en la red de prueba.`);
      }
      if (asset === "USDC" && theirs.usdc === null) {
        setStage({ step: "form" });
        return setFormError(`${recipientLabel(lookup.recipient)} todavía no puede recibir USDC. Envíale XLM.`);
      }
    } catch {
      setStage({ step: "form" });
      return setFormError("No pudimos consultar la red de Stellar. Intenta de nuevo.");
    }
    setStage({ step: "review", recipient: lookup.recipient, amount: checked.amount });
  };

  const onConfirm = async () => {
    if (stage.step !== "review") return;
    const { recipient, amount: value } = stage;
    const flight: InFlightPayment = {
      memo: newPaymentRef(),
      startedAt: new Date().toISOString(),
      toWallet: recipient.wallet,
      toLabel: recipientLabel(recipient),
      amount: value,
      asset,
      note: note.trim(),
    };
    // Written BEFORE the SDK call: from here on a payment may exist, and a reload must find that out.
    rememberPayment(address, flight);
    setStage({ step: "sending", recipient, flight });
    let outcome: Awaited<ReturnType<typeof sendPayment>> | undefined;
    // So the phase read below belongs to this send, not to an earlier one.
    getClient().resetTransactionState();
    try {
      outcome = await sendPayment({
        destination: recipient.wallet,
        amount: value,
        asset: pollarAsset(asset),
        options: paymentOptions(flight.memo),
      });
    } catch (err) {
      // A throw means "unknown", never "not sent".
      outcome = { status: "error", details: err instanceof Error ? err.message : undefined };
    }
    const verdict = classifyWithPhase(outcome, getClient().getTransactionState());
    if (verdict === "rejected") {
      forgetPayment(address);
      setStage({ step: "review", recipient, amount: value });
      const why = outcome?.status === "error" ? (outcome.details ?? outcome.message ?? "") : "";
      const reason = rejectionReason(outcome);
      setFormError(reason ? rejectionText(reason, outcome) : `No se pudo enviar y no se movió dinero.${why ? ` Pollar dijo: ${why.slice(0, 160)}` : ""}`);
      return;
    }
    if (verdict === "sent") onSent?.();
    // What Pollar said when there is no hash: shown so a failure can be diagnosed (never contains keys).
    const detail =
      outcome && outcome.status === "error" && !outcome.hash
        ? [outcome.code, outcome.resultCode, outcome.details ?? outcome.message].filter(Boolean).join(" · ").slice(0, 200)
        : undefined;
    if (detail) console.warn("[pagos] Pollar no devolvió hash:", detail);
    setStage({ step: "verifying", recipient, flight, hash: outcome?.hash, detail });
  };

  const reset = () => {
    setStage({ step: "form" });
    setAmount(DEFAULT_AMOUNT);
    setNote("");
    setFormError(null);
  };

  if (stage.step === "verifying" || stage.step === "done") {
    const { flight, recipient } = stage;
    const done = stage.step === "done";
    const hash = stage.hash;
    return (
      <section className="card pay-card" aria-label={done ? "Pago enviado" : "Confirmando el pago"}>
        <h2>{done ? "Pago enviado" : "Confirmando tu pago…"}</h2>
        {recipient ? <PayWho recipient={recipient} /> : <p className="pay-who-name">Para {flight.toLabel || shortAddress(flight.toWallet)}</p>}
        <p className="pay-amount">
          {trimAmount(flight.amount)} {flight.asset}
        </p>
        <p role="status" className="muted">
          {done
            ? "Listo: el pago ya está en la red de prueba y en tu historial."
            : "Lo estamos buscando en la red de Stellar. No lo envíes de nuevo: si cierras esta pantalla, lo seguimos buscando cuando vuelvas."}
        </p>
        {!done ? <Countdown startedAt={flight.startedAt} /> : null}
        {!done && stage.detail ? <p className="muted field-hint">Pollar respondió: {stage.detail}</p> : null}
        {done && stage.warning ? <p className="field-hint error">{stage.warning}</p> : null}
        <div className="form-actions">
          {hash ? (
            <a className="btn" href={explorerTxUrl(hash)} target="_blank" rel="noreferrer">
              Ver en stellar.expert
            </a>
          ) : null}
          {done ? (
            <button type="button" className="btn btn-primary" onClick={reset}>
              Enviar otro
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  if (stage.step === "review" || stage.step === "sending") {
    const sending = stage.step === "sending";
    const value = sending ? stage.flight.amount : stage.amount;
    return (
      <section className="card pay-card" aria-label="Revisa el envío">
        <h2>Revisa el envío</h2>
        <PayWho recipient={stage.recipient} />
        <p className="pay-amount">
          {trimAmount(value)} {asset}
        </p>
        {note.trim() ? <p className="muted pay-note">“{note.trim()}”</p> : null}
        <p className="muted field-hint">Red de prueba (testnet): este dinero no tiene valor real. Un pago enviado no se puede deshacer.</p>
        {formError ? (
          <p className="field-hint error" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="form-actions">
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={sending}>
            {sending ? "Enviando…" : `Enviar ${trimAmount(value)} ${asset}`}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={sending}
            onClick={() => {
              setStage({ step: "form" });
              setFormError(null);
            }}
          >
            Editar
          </button>
        </div>
        {sending ? <p className="muted field-hint">Si usas Freighter, confirma el pago en la extensión.</p> : null}
      </section>
    );
  }

  return (
    <form className="card pay-card" onSubmit={onReview} noValidate aria-label="Enviar dinero">
      <h2>Enviar</h2>
      <div className="field">
        <label htmlFor={toId}>Para</label>
        <input
          id={toId}
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={60}
          placeholder="@usuario o dirección G…"
          value={to}
          aria-describedby={`${toId}-hint`}
          onChange={(e) => setTo(e.target.value)}
        />
        <div id={`${toId}-hint`} aria-live="polite">
          {lookup.step === "searching" ? <p className="field-hint muted">Buscando…</p> : null}
          {lookup.step === "error" ? <p className="field-hint error">{lookup.message}</p> : null}
          {lookup.step === "found" ? <PayWho recipient={lookup.recipient} compact /> : null}
        </div>
      </div>

      <fieldset className="pay-assets">
        <legend>Activo</legend>
        {PAYMENT_ASSETS.map((a) => (
          <label key={a} className="pay-asset" data-active={asset === a}>
            <input type="radio" name="asset" value={a} checked={asset === a} onChange={() => setAsset(a)} />
            {a}
          </label>
        ))}
      </fieldset>

      <div className="field">
        <label htmlFor={amountId}>Monto</label>
        <input
          id={amountId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,02"
          value={amount}
          aria-invalid={amountCheck !== null && !amountCheck.ok}
          aria-describedby={`${amountId}-hint`}
          onChange={(e) => setAmount(e.target.value)}
        />
        <div className="pay-quick" role="group" aria-label="Montos rápidos">
          {QUICK[asset].map((q) => (
            <button key={q} type="button" className="pay-quick-btn" data-active={amount.replace(",", ".") === q} onClick={() => setAmount(q.replace(".", ","))}>
              {q.replace(".", ",")} {asset}
            </button>
          ))}
        </div>
        <p id={`${amountId}-hint`} className={amountCheck && !amountCheck.ok ? "field-hint error" : "field-hint muted"}>
          {amountCheck && !amountCheck.ok
            ? amountCheck.error
            : balance !== null
              ? `Tienes ${trimAmount(balance)} ${asset}.`
              : " "}
        </p>
      </div>

      <div className="field">
        <label htmlFor={noteId}>Nota (opcional)</label>
        <input
          id={noteId}
          type="text"
          autoComplete="off"
          maxLength={NOTE_MAX}
          placeholder="Ej.: la pizza del viernes"
          value={note}
          aria-describedby={`${noteId}-hint`}
          onChange={(e) => setNote(e.target.value)}
        />
        <p id={`${noteId}-hint`} className="field-hint muted">
          Solo la ven tú y quien recibe. No se guarda en la red.
        </p>
      </div>

      {formError ? (
        <p className="field-hint error" role="alert">
          {formError}
        </p>
      ) : null}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={stage.step === "checking" || lookup.step !== "found"}>
          {stage.step === "checking" ? "Revisando…" : "Revisar envío"}
        </button>
      </div>
    </form>
  );
}

/**
 * How long until the app can say for sure whether a payment without a hash
 * landed: the transaction's 5-minute lifetime plus slack. Past that, the
 * memo search answers "never landed" and the form comes back.
 */
function Countdown({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((attemptDeadlineMs(Date.parse(startedAt)) - now) / 1000));
  if (left === 0) return <p className="muted field-hint">Revisando una última vez en la red…</p>;
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");
  return (
    <p className="muted field-hint">
      Si el pago no aparece, en {mm}:{ss} te avisamos y podrás intentarlo de nuevo. Mientras tanto no se puede enviar otra vez, para
      que nunca pagues doble.
    </p>
  );
}

/** The recipient with their Kosmonauta, so the user sees who gets the money before confirming. */
function PayWho({ recipient, compact = false }: { recipient: Recipient; compact?: boolean }) {
  if (recipient.kind === "address") {
    return (
      <div className="pay-who" data-compact={compact}>
        <div>
          <p className="pay-who-name">Wallet de Stellar</p>
          <p className="muted pay-who-sub">
            <code>{shortAddress(recipient.wallet)}</code> · no es un usuario de Kosmovia
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="pay-who" data-compact={compact}>
      <Avatar
        seed={recipient.avatarSeed || recipient.wallet}
        style={recipient.avatarStyle}
        size={compact ? 36 : 56}
        username={recipient.username}
      />
      <div>
        <p className="pay-who-name">{recipient.displayName}</p>
        <p className="muted pay-who-sub">
          @{recipient.username} · <code>{shortAddress(recipient.wallet)}</code>
        </p>
      </div>
    </div>
  );
}
