'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { vaquitaService, VaquitaError, type VaquitaDetail } from '@/services';
import { kosmovia, MiniAppError, type MiniAppUser } from '@/lib/miniapp-sdk/client';
import s from './vaquita.module.css';
import Logo from './Logo';
import { Avatar, ProgressBar, SkeletonBlock, StatusChip } from './ui';
import { contributorsText, fmtUsdc, isActive, parseAmount, percent, timeAgo } from './util';

const QUICK = ['0.01', '0.05', '0.10'];
const DEFINITIVE_AFTER_PAY =
  'Tu aporte salió, pero no se pudo sumar a la vaquita. No vuelvas a pagar: avisa a quien la creó.';

type Pending = { paymentId: string; final: string | null };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pendingKey = (id: string) => `vq-pending-${id}`;

function readPending(id: string): Pending | null {
  try {
    const raw = sessionStorage.getItem(pendingKey(id));
    return raw ? (JSON.parse(raw) as Pending) : null;
  } catch {
    return null;
  }
}
function writePending(id: string, p: Pending | null) {
  try {
    if (p) sessionStorage.setItem(pendingKey(id), JSON.stringify(p));
    else sessionStorage.removeItem(pendingKey(id));
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

const CONFETTI = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2;
  const r = 70 + (i % 3) * 22;
  return {
    dx: Math.round(Math.cos(a) * r),
    dy: Math.round(Math.sin(a) * r * 0.8 - 20),
    color: ['#f2a03d', '#b84a26', '#5aa86a', '#e8c26b'][i % 4],
    delay: (i % 4) * 30,
  };
});

export default function Detail({
  id,
  user,
  onBack,
}: {
  id: string;
  user: MiniAppUser;
  onBack: () => void;
}) {
  const [data, setData] = useState<VaquitaDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [stage, setStage] = useState<'idle' | 'paying' | 'linking'>('idle');
  const [payError, setPayError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [thanks, setThanks] = useState<string | null>(null);

  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const thanksRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const d = await vaquitaService.get(id);
      setData(d);
      const p = readPending(id);
      if (p) setPending(p);
    } catch (e) {
      setLoadError(e instanceof Error && e.message ? e.message : 'No pudimos abrir esta vaquita.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const header = (
    <header className={s.header}>
      <button type="button" className={s.iconBtn} onClick={onBack} aria-label="Volver a las vaquitas">
        ←
      </button>
      <h1 className={s.pageTitle}>{data ? data.vaquita.title : 'Vaquita'}</h1>
    </header>
  );

  if (loadError) {
    return (
      <div className={s.wrap}>
        {header}
        <div className={`${s.notice} ${s.noticeErr}`} role="alert">
          <span>{loadError}</span>
          <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => void load()}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={s.wrap} role="status" aria-live="polite">
        <span className={s.srOnly}>Cargando vaquita…</span>
        {header}
        <SkeletonBlock h={190} />
        <SkeletonBlock h={120} />
      </div>
    );
  }

  const v = data.vaquita;
  const active = isActive(v);
  const isOwner = v.creator.id === user.id || v.creatorWallet === user.wallet;
  const reached = v.raisedUsdc >= v.goalUsdc;
  const parsed = parseAmount(amount);
  const amountError =
    amount.trim() === ''
      ? 'Elige o escribe un monto.'
      : parsed === null
        ? 'Escribe solo números, por ejemplo 0.05.'
        : parsed < 0.01
          ? 'El aporte mínimo es 0.01 USDC.'
          : '';
  const showAmountError = amountTouched && amountError;
  const busy = stage !== 'idle';

  /** Vincula el pago con la vaquita. Reintenta 2 veces si es un problema de red. */
  async function link(paymentId: string) {
    setStage('linking');
    setPayError(null);
    let lastErr: unknown = null;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await vaquitaService.contribute(id, paymentId);
        writePending(id, null);
        setPending(null);
        setData((d) =>
          d
            ? { vaquita: r.vaquita, contributions: [r.contribution, ...d.contributions.filter((c) => c.id !== r.contribution.id)] }
            : d,
        );
        celebrate();
        setStage('idle');
        return;
      } catch (e) {
        lastErr = e;
        if (e instanceof VaquitaError && e.code === 'already_linked') {
          writePending(id, null);
          setPending(null);
          await load();
          celebrate();
          setStage('idle');
          return;
        }
        const transient = !(e instanceof VaquitaError) || e.code === 'unknown' || e.code === 'rate_limited';
        if (!transient) break;
        if (i < 2) await wait(900 * (i + 1));
      }
    }
    const definitive = lastErr instanceof VaquitaError && lastErr.code !== 'unknown' && lastErr.code !== 'rate_limited';
    if (definitive) {
      const fin = { paymentId, final: `${(lastErr as VaquitaError).message} ${DEFINITIVE_AFTER_PAY}` };
      writePending(id, fin);
      setPending(fin);
    } else {
      const p: Pending = { paymentId, final: null };
      writePending(id, p);
      setPending(p);
    }
    setStage('idle');
  }

  function celebrate() {
    setAmount('');
    setAmountTouched(false);
    setThanks('¡Gracias por aportar!');
    setTimeout(() => thanksRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
  }

  async function contribute() {
    setAmountTouched(true);
    if (amountError || parsed === null || busy) return;
    setThanks(null);
    setPayError(null);
    setStage('paying');
    let paymentId: string;
    try {
      const pay = await kosmovia.requestPayment({
        to: v.creatorWallet,
        amount: parsed,
        asset: 'USDC',
        note: `Aporte a ${v.title}`,
      });
      paymentId = pay.paymentId;
    } catch (e) {
      setStage('idle');
      if (e instanceof MiniAppError && e.code === 'user_rejected') {
        setPayError('No pasa nada, no se hizo ningún cobro.');
      } else if (e instanceof MiniAppError && e.code === 'timeout') {
        setPayError('Kosmovia tardó en responder. Antes de volver a aportar, revisa en tu wallet si el pago salió, para no pagar dos veces.');
      } else {
        setPayError(e instanceof Error && e.message ? e.message : 'No se pudo hacer el aporte. No se cobró nada.');
      }
      return;
    }
    writePending(id, { paymentId, final: null });
    await link(paymentId);
  }

  async function doClose() {
    setClosing(true);
    setCloseError(null);
    try {
      const closed = await vaquitaService.close(id);
      setData((d) => (d ? { ...d, vaquita: closed } : d));
      setConfirmClose(false);
    } catch (e) {
      setCloseError(e instanceof Error && e.message ? e.message : 'No pudimos cerrar la vaquita. Intenta de nuevo.');
    }
    setClosing(false);
  }

  async function share() {
    setShareMsg(null);
    try {
      await kosmovia.share(`[VAQUITA:${v.id}]`);
      setShareMsg('Listo, compartida en el chat.');
    } catch (e) {
      if (e instanceof MiniAppError && e.code === 'user_rejected') return;
      setShareMsg(e instanceof Error && e.message ? e.message : 'No se pudo compartir. Intenta de nuevo.');
    }
  }

  return (
    <div className={s.wrap}>
      {header}

      <section className={s.card} aria-label="Avance de la vaquita">
        <div className={s.big}>
          {fmtUsdc(v.raisedUsdc)} <span className={s.bigUnit}>de {fmtUsdc(v.goalUsdc)} USDC</span>
        </div>
        <ProgressBar v={v} big />
        <div className={s.cardRow}>
          <span className={s.strong}>{percent(v)}% de la meta</span>
          <StatusChip v={v} />
        </div>
        <div className={s.stats}>
          <div className={s.stat}>
            Aportantes
            <b>{v.contributorsCount}</b>
          </div>
          <div className={s.stat}>
            Falta
            <b>{reached ? '¡Nada!' : `${fmtUsdc(v.goalUsdc - v.raisedUsdc)} USDC`}</b>
          </div>
        </div>
        {v.description && <p className={s.description}>{v.description}</p>}
        <div className={s.person} style={{ marginTop: 14 }}>
          <Avatar user={v.creator} />
          <span className={s.personText}>
            <span className={s.small + ' ' + s.muted}>Creada por</span>
            <span className={s.personName}>{v.creator.displayName}</span>
          </span>
        </div>
      </section>

      <div ref={thanksRef} aria-live="polite">
        {thanks && (
          <div className={`${s.card} ${s.celebrate}`}>
            {CONFETTI.map((c, i) => (
              <span
                key={i}
                className={s.confetti}
                aria-hidden="true"
                style={{ background: c.color, animationDelay: `${c.delay}ms`, ['--dx' as string]: `${c.dx}px`, ['--dy' as string]: `${c.dy}px` }}
              />
            ))}
            <span className={s.celebrateCow}>
              <Logo size={72} />
            </span>
            <div className={s.celebrateTitle}>{thanks}</div>
            <p className={s.muted}>Tu aporte ya se sumó a la vaquita.</p>
          </div>
        )}
      </div>

      {pending && (
        <div className={`${s.notice} ${pending.final ? s.noticeErr : s.noticeWarn}`} role="alert">
          {pending.final ? (
            <span>{pending.final}</span>
          ) : (
            <>
              <span>
                Tu aporte salió pero no se sumó todavía. No vuelvas a pagar: toca Reintentar para sumarlo.
              </span>
              <button
                type="button"
                className={`${s.btn} ${s.btnPrimary}`}
                disabled={busy}
                onClick={() => void link(pending.paymentId)}
              >
                {stage === 'linking' ? 'Sumando…' : 'Reintentar'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Aportar (no si es mi vaquita) */}
      {!isOwner && active && (
        <section className={s.card} aria-labelledby="vq-aportar">
          <h2 className={s.sectionTitle} id="vq-aportar">
            Aportar
          </h2>
          <div className={s.form} style={{ marginTop: 12 }}>
            <div className={s.quick} role="group" aria-label="Montos rápidos en USDC">
              {QUICK.map((q) => (
                <button
                  key={q}
                  type="button"
                  className={`${s.chipBtn} ${parsed === Number(q) && amount === q ? s.chipBtnOn : ''}`}
                  aria-pressed={amount === q}
                  disabled={busy}
                  onClick={() => {
                    setAmount(q);
                    setAmountTouched(false);
                    setPayError(null);
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
            <div className={s.field}>
              <label className={s.label} htmlFor="vq-amount">
                O escribe otro monto
              </label>
              <div className={s.moneyWrap}>
                <input
                  id="vq-amount"
                  className={`${s.input} ${showAmountError ? s.inputError : ''}`}
                  value={amount}
                  inputMode="decimal"
                  placeholder="0.25"
                  autoComplete="off"
                  disabled={busy}
                  aria-invalid={!!showAmountError}
                  aria-describedby={showAmountError ? 'vq-amount-err' : 'vq-amount-hint'}
                  onChange={(e) => setAmount(e.target.value)}
                  onBlur={() => amount && setAmountTouched(true)}
                />
                <span className={s.moneyUnit} aria-hidden="true">
                  USDC
                </span>
              </div>
              {showAmountError ? (
                <span id="vq-amount-err" className={s.errorText} role="alert">
                  {amountError}
                </span>
              ) : (
                <span id="vq-amount-hint" className={s.hint}>
                  Tu aporte llega directo a {v.creator.displayName}, quien organiza esta vaquita. Kosmovia te pedirá tu PIN para confirmar.
                </span>
              )}
            </div>
            {payError && (
              <div className={`${s.notice} ${s.noticeWarn}`} role="alert">
                {payError}
              </div>
            )}
            <button
              type="button"
              className={`${s.btn} ${s.btnPrimary} ${s.btnBlock}`}
              disabled={busy || !!pending}
              onClick={() => void contribute()}
            >
              {stage === 'paying'
                ? 'Esperando a Kosmovia…'
                : stage === 'linking'
                  ? 'Sumando tu aporte…'
                  : parsed !== null && !amountError
                    ? `Aportar ${fmtUsdc(parsed)} USDC`
                    : 'Aportar'}
            </button>
          </div>
        </section>
      )}

      {!isOwner && !active && (
        <div className={`${s.notice} ${s.noticeWarn}`}>
          Esta vaquita ya no recibe aportes. ¡Gracias a quienes aportaron!
        </div>
      )}

      {/* Acciones de quien la creó */}
      {isOwner && (
        <section className={s.card} aria-label="Acciones de tu vaquita">
          <div className={s.form} style={{ gap: 12 }}>
            <p className={s.small + ' ' + s.muted}>
              {active
                ? 'Esta vaquita es tuya: los aportes llegan directo a tu wallet.'
                : 'Esta vaquita ya no recibe aportes.'}
            </p>
            <button type="button" className={`${s.btn} ${s.btnPrimary} ${s.btnBlock}`} onClick={() => void share()}>
              Compartir en el chat
            </button>
            {shareMsg && (
              <div className={`${s.notice} ${s.noticeOk}`} role="status">
                {shareMsg}
              </div>
            )}
            {v.status === 'open' &&
              (confirmClose ? (
                <div className={s.confirmBox} role="group" aria-label="Confirmar cierre">
                  <strong>¿Cerrar esta vaquita?</strong>
                  <span className={s.small + ' ' + s.muted}>Ya no recibirá más aportes y no se puede reabrir.</span>
                  {closeError && (
                    <div className={`${s.notice} ${s.noticeErr}`} role="alert">
                      {closeError}
                    </div>
                  )}
                  <div className={s.row}>
                    <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => setConfirmClose(false)} disabled={closing}>
                      Cancelar
                    </button>
                    <button type="button" className={`${s.btn} ${s.btnDanger}`} onClick={() => void doClose()} disabled={closing}>
                      {closing ? 'Cerrando…' : 'Sí, cerrar'}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className={`${s.btn} ${s.btnSecondary} ${s.btnBlock}`} onClick={() => setConfirmClose(true)}>
                  Cerrar vaquita
                </button>
              ))}
          </div>
        </section>
      )}

      {/* Aportes recientes */}
      <section className={s.card} aria-labelledby="vq-aportes">
        <h2 className={s.sectionTitle} id="vq-aportes">
          Aportes recientes
        </h2>
        <p className={`${s.small} ${s.muted}`}>{contributorsText(v.contributorsCount)}</p>
        {data.contributions.length === 0 ? (
          <p className={s.muted} style={{ marginTop: 10 }}>
            {isOwner ? 'Cuando alguien aporte, lo verás aquí.' : 'Sé la primera persona en aportar.'}
          </p>
        ) : (
          <ul className={`${s.aportes} ${s.list}`} style={{ gap: 0, marginTop: 6 }}>
            {data.contributions.map((c) => (
              <li key={c.id} className={s.aporte}>
                <span className={s.person}>
                  <Avatar user={c.contributor} />
                  <span className={s.personText}>
                    <span className={s.personName}>{c.contributor.displayName}</span>
                    <span className={`${s.small} ${s.muted}`}>{timeAgo(c.createdAt)}</span>
                  </span>
                </span>
                <span className={s.aporteAmount}>
                  {fmtUsdc(c.amountUsdc)} USDC
                  <br />
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${encodeURIComponent(c.txHash)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Ver en Stellar
                    <span className={s.srOnly}> (se abre en otra pestaña)</span>
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
