'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { vaquitaService, walletService, VaquitaError } from '../../services';
import type { Vaquita, VaquitaDetail } from '../../services';
import type { AppProps } from './registry';

const QUICK_AMOUNTS = [0.01, 0.05, 0.1];

export function fmtUsdc(n: number): string {
  return n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 7 });
}

export function percent(v: Vaquita): number {
  return v.goalUsdc > 0 ? Math.min(100, Math.floor((v.raisedUsdc / v.goalUsdc) * 100)) : 0;
}

export function isExpired(v: Vaquita): boolean {
  return v.status === 'open' && v.deadline !== null && new Date(v.deadline).getTime() <= Date.now();
}

export function deadlineLabel(v: Vaquita): string | null {
  if (v.status === 'closed') return null;
  if (!v.deadline) return 'Sin fecha límite';
  const ms = new Date(v.deadline).getTime() - Date.now();
  if (ms <= 0) return 'Vencida';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'Vence en menos de 1 hora';
  if (hours < 24) return `Vence en ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Vence en 1 día' : `Vence en ${days} días`;
}

function stateBadge(v: Vaquita): { text: string; cls: string } {
  if (v.status === 'closed') return { text: 'Cerrada', cls: 'soon' };
  if (isExpired(v)) return { text: 'Vencida', cls: 'soon' };
  if (v.raisedUsdc >= v.goalUsdc) return { text: 'Meta lograda', cls: 'official' };
  return { text: 'Abierta', cls: 'official' };
}

function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'hace un momento';
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

function errText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function Progress({ v }: { v: Vaquita }) {
  const pct = percent(v);
  return (
    <div className="kv-vq-progress">
      <div className="kv-vq-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progreso de la vaquita">
        <div className="kv-vq-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="kv-vq-bar-text">
        <span>
          <strong>{fmtUsdc(v.raisedUsdc)}</strong> / {fmtUsdc(v.goalUsdc)} USDC
        </span>
        <span>{pct}%</span>
      </div>
    </div>
  );
}

type Screen = { name: 'list' } | { name: 'create' } | { name: 'detail'; id: string };

export function VaquitaApp({ community, currentUser, requestApproval, notify, initialParams, shareToChannel }: AppProps) {
  const [screen, setScreen] = useState<Screen>(
    initialParams?.vaquitaId ? { name: 'detail', id: initialParams.vaquitaId } : { name: 'list' }
  );
  if (screen.name === 'create') {
    return (
      <CreateForm
        slug={community.slug}
        onCancel={() => setScreen({ name: 'list' })}
        onCreated={(v) => {
          notify('ok', 'Vaquita creada.');
          setScreen({ name: 'detail', id: v.id });
        }}
      />
    );
  }
  if (screen.name === 'detail') {
    return (
      <Detail
        id={screen.id}
        currentUserId={currentUser.id}
        requestApproval={requestApproval}
        notify={notify}
        shareToChannel={shareToChannel}
        onBack={() => setScreen({ name: 'list' })}
      />
    );
  }
  return <List slug={community.slug} onCreate={() => setScreen({ name: 'create' })} onOpen={(id) => setScreen({ name: 'detail', id })} />;
}

function List({ slug, onCreate, onOpen }: { slug: string; onCreate: () => void; onOpen: (id: string) => void }) {
  const [items, setItems] = useState<Vaquita[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    vaquitaService.list(slug).then(setItems).catch((e) => setError(errText(e, 'No pudimos cargar las vaquitas.')));
  }, [slug]);
  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="kv-vq-stack" role="alert">
        <p className="kv-vq-error">{error}</p>
        <button type="button" className="kv-vq-btn" onClick={load}>Reintentar</button>
      </div>
    );
  }
  if (!items) return <p className="kv-apps-intro" role="status">Cargando…</p>;
  return (
    <div className="kv-vq-stack">
      <button type="button" className="kv-vq-btn primary" onClick={onCreate}>+ Crear vaquita</button>
      {items.length === 0 ? (
        <div className="kv-app-soon">
          <span className="kv-app-soon-icon" aria-hidden="true">🐄</span>
          <strong>Aún no hay vaquitas</strong>
          <p>Crea la primera para juntar dinero con tu comunidad.</p>
        </div>
      ) : (
        <ul className="kv-apps-list" aria-label="Vaquitas de la comunidad">
          {items.map((v) => {
            const badge = stateBadge(v);
            const dl = deadlineLabel(v);
            return (
              <li key={v.id}>
                <button type="button" className="kv-app-card kv-vq-card" onClick={() => onOpen(v.id)} aria-label={`Abrir vaquita ${v.title}`}>
                  <span className="kv-app-text">
                    <span className="kv-app-name">
                      {v.title}
                      <span className={`kv-app-badge ${badge.cls}`}>{badge.text}</span>
                    </span>
                    <Progress v={v} />
                    <span className="kv-app-perms">
                      {v.contributorsCount} {v.contributorsCount === 1 ? 'aportante' : 'aportantes'}
                      {dl ? ` · ${dl}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CreateForm({ slug, onCancel, onCreated }: { slug: string; onCancel: () => void; onCreated: (v: Vaquita) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [goal, setGoal] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = new Date();
  const minDate = new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10);
  const maxDate = new Date(today.getTime() + 364 * 86_400_000).toISOString().slice(0, 10);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const goalNum = parseFloat(goal.replace(',', '.'));
    if (!title.trim()) return setError('Escribe un título.');
    if (!(goalNum >= 0.01)) return setError('La meta debe ser de al menos 0,01 USDC.');
    setBusy(true);
    setError(null);
    try {
      const v = await vaquitaService.create(slug, {
        title: title.trim(),
        description: description.trim() || undefined,
        goalUsdc: goalNum,
        deadline: date ? new Date(`${date}T23:59:59`).toISOString() : undefined,
      });
      onCreated(v);
    } catch (err) {
      setError(errText(err, 'No pudimos crear la vaquita.'));
      setBusy(false);
    }
  };

  return (
    <form className="kv-vq-stack" onSubmit={submit}>
      <button type="button" className="kv-vq-link" onClick={onCancel}>← Volver a la lista</button>
      <label className="kv-vq-field">
        <span>Título</span>
        <input className="form-input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="Asado del sábado" required />
      </label>
      <label className="kv-vq-field">
        <span>Descripción (opcional)</span>
        <textarea className="form-input" value={description} maxLength={280} rows={3} onChange={(e) => setDescription(e.target.value)} />
        <small>{description.length}/280</small>
      </label>
      <label className="kv-vq-field">
        <span>Meta en USDC</span>
        <input className="form-input" inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="50" required />
      </label>
      <label className="kv-vq-field">
        <span>Fecha límite (opcional)</span>
        <input className="form-input" type="date" value={date} min={minDate} max={maxDate} onChange={(e) => setDate(e.target.value)} />
      </label>
      {error ? <p className="kv-vq-error" role="alert">{error}</p> : null}
      <button type="submit" className="kv-vq-btn primary" disabled={busy}>{busy ? 'Creando…' : 'Crear vaquita'}</button>
    </form>
  );
}

interface DetailProps {
  id: string;
  currentUserId: string;
  requestApproval: AppProps['requestApproval'];
  notify: AppProps['notify'];
  shareToChannel?: AppProps['shareToChannel'];
  onBack: () => void;
}

function Detail({ id, currentUserId, requestApproval, notify, shareToChannel, onBack }: DetailProps) {
  const [data, setData] = useState<VaquitaDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [paying, setPaying] = useState(false);
  const [pending, setPending] = useState<{ paymentId: string; amount: number } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await vaquitaService.get(id);
      if (alive.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(errText(e, 'No pudimos cargar la vaquita.'));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  /** Vincula el pago ya hecho; reintenta 2 veces ante fallas de red con el mismo id de pago. */
  const link = async (paymentId: string, amt: number) => {
    let lastErr: unknown = null;
    for (let i = 0; i < 3; i++) {
      try {
        await vaquitaService.contribute(id, paymentId);
        setPending(null);
        notify('ok', `Aportaste ${fmtUsdc(amt)} USDC. ¡Gracias!`);
        setAmount('');
        await load();
        return;
      } catch (e) {
        lastErr = e;
        if (e instanceof VaquitaError && e.code === 'already_linked') {
          setPending(null);
          await load();
          return;
        }
        // Solo se reintenta ante fallas de red o desconocidas; el resto son respuestas definitivas.
        if (e instanceof VaquitaError && e.code !== 'unknown' && e.code !== 'rate_limited') break;
      }
    }
    if (lastErr instanceof VaquitaError && lastErr.code !== 'unknown' && lastErr.code !== 'rate_limited') {
      setPending(null);
      notify('error', `Tu pago salió, pero no se sumó a la vaquita: ${lastErr.message}`);
      await load();
    } else {
      setPending({ paymentId, amount: amt });
    }
  };

  const contribute = async (v: Vaquita) => {
    const amt = parseFloat(amount.replace(',', '.'));
    if (!(amt >= 0.01) || paying) return;
    setPaying(true);
    try {
      const approval = await requestApproval({ to: v.creatorWallet, toLabel: v.creator.username, asset: 'USDC', amount: amt });
      if (!approval) return;
      const tx = await walletService.sendPayment({ to: v.creatorWallet, amount: amt, asset: 'USDC', approval });
      await link(tx.id, amt);
    } catch (e) {
      notify('error', errText(e, 'No se pudo completar el aporte.'));
    } finally {
      if (alive.current) setPaying(false);
    }
  };

  const retry = async () => {
    if (!pending || paying) return;
    setPaying(true);
    await link(pending.paymentId, pending.amount);
    if (alive.current) setPaying(false);
  };

  const doClose = async () => {
    setClosing(true);
    try {
      await vaquitaService.close(id);
      notify('ok', 'Vaquita cerrada.');
      setConfirmClose(false);
      await load();
    } catch (e) {
      notify('error', errText(e, 'No pudimos cerrar la vaquita.'));
    } finally {
      if (alive.current) setClosing(false);
    }
  };

  if (error) {
    return (
      <div className="kv-vq-stack" role="alert">
        <button type="button" className="kv-vq-link" onClick={onBack}>← Volver a la lista</button>
        <p className="kv-vq-error">{error}</p>
        <button type="button" className="kv-vq-btn" onClick={() => void load()}>Reintentar</button>
      </div>
    );
  }
  if (!data) return <p className="kv-apps-intro" role="status">Cargando…</p>;

  const v = data.vaquita;
  const mine = v.creator.id === currentUserId;
  const expired = isExpired(v);
  const canContribute = v.status === 'open' && !expired && !mine;
  const badge = stateBadge(v);
  const dl = deadlineLabel(v);

  return (
    <div className="kv-vq-stack">
      <button type="button" className="kv-vq-link" onClick={onBack}>← Volver a la lista</button>
      <div>
        <h3 className="kv-vq-title">{v.title}</h3>
        <div className="kv-vq-meta">
          <span className={`kv-app-badge ${badge.cls}`}>{badge.text}</span>
          <span>Creada por {v.creator.username}</span>
        </div>
      </div>
      {v.description ? <p className="kv-vq-desc">{v.description}</p> : null}
      <Progress v={v} />
      <p className="kv-app-perms">
        {v.contributorsCount} {v.contributorsCount === 1 ? 'aportante' : 'aportantes'}
        {dl ? ` · ${dl}` : ''}
      </p>

      {pending ? (
        <div className="kv-vq-warn" role="alert">
          <p>Tu pago salió pero no pudimos sumarlo a la vaquita; reintenta.</p>
          <button type="button" className="kv-vq-btn primary" onClick={() => void retry()} disabled={paying}>
            {paying ? 'Reintentando…' : 'Reintentar'}
          </button>
        </div>
      ) : canContribute ? (
        <form
          className="kv-vq-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void contribute(v);
          }}
        >
          <span className="kv-vq-label">Aportar</span>
          <div className="kv-vq-quick" role="group" aria-label="Montos rápidos">
            {QUICK_AMOUNTS.map((q) => (
              <button
                key={q}
                type="button"
                className={`kv-vq-chip ${parseFloat(amount.replace(',', '.')) === q ? 'active' : ''}`}
                onClick={() => setAmount(String(q))}
                disabled={paying}
              >
                {q.toFixed(2)}
              </button>
            ))}
          </div>
          <label className="kv-vq-field">
            <span>Otro monto en USDC</span>
            <input className="form-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.01" disabled={paying} />
          </label>
          <button type="submit" className="kv-vq-btn primary" disabled={paying || !(parseFloat(amount.replace(',', '.')) >= 0.01)}>
            {paying ? 'Aportando…' : 'Aportar'}
          </button>
        </form>
      ) : mine && v.status === 'open' && !expired ? (
        <p className="kv-app-perms">Es tu vaquita: el dinero llega directo a tu wallet.</p>
      ) : null}

      {shareToChannel ? (
        <button type="button" className="kv-vq-btn" onClick={() => void shareToChannel(`[VAQUITA:${v.id}]`)}>
          Compartir en el canal
        </button>
      ) : null}

      {mine && v.status === 'open' ? (
        confirmClose ? (
          <div className="kv-vq-warn" role="alertdialog" aria-label="Confirmar cierre">
            <p>¿Cerrar esta vaquita? Ya no se podrá reabrir ni recibir aportes.</p>
            <div className="kv-vq-row">
              <button type="button" className="kv-vq-btn" onClick={() => setConfirmClose(false)} disabled={closing}>Cancelar</button>
              <button type="button" className="kv-vq-btn danger" onClick={() => void doClose()} disabled={closing}>
                {closing ? 'Cerrando…' : 'Sí, cerrar'}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="kv-vq-btn danger" onClick={() => setConfirmClose(true)}>Cerrar vaquita</button>
        )
      ) : null}

      <h4 className="kv-apps-section">Aportes</h4>
      {data.contributions.length === 0 ? (
        <p className="kv-app-perms">Todavía no hay aportes.</p>
      ) : (
        <ul className="kv-apps-list" aria-label="Aportes">
          {data.contributions.map((c) => (
            <li key={c.id} className="kv-vq-contrib">
              <span className="kv-vq-contrib-who">
                <strong>{c.contributor.displayName || c.contributor.username}</strong>
                <span className="kv-app-perms">{ago(c.createdAt)}</span>
              </span>
              <span className="kv-vq-contrib-amt">
                +{fmtUsdc(c.amountUsdc)}
                <a href={`https://stellar.expert/explorer/testnet/tx/${c.txHash}`} target="_blank" rel="noreferrer" className="wallet-explorer-link">
                  Ver en Stellar ↗
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
