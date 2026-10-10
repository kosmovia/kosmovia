'use client';

import { useCallback, useEffect, useState } from 'react';
import { retosService, type Reto } from '@/services';
import type { MiniAppUser } from '@/lib/miniapp-sdk/client';
import s from './retos.module.css';
import Logo from './Logo';
import { Avatar, ErrorBox, SkeletonBlock } from './ui';
import { usePoll } from './usePoll';
import { GAME_NAME, errText, firstName, handle, leftText, outcomeOf, rivalOf } from './util';

const FINISHED_SHOWN = 5;

function statusLine(r: Reto): { text: string; tone: 'go' | 'wait' | 'win' | 'loss' | 'draw' | 'off' } {
  if (r.status === 'active') return r.yourTurn ? { text: 'Te toca', tone: 'go' } : { text: `Esperando a ${handle(rivalOf(r))}`, tone: 'wait' };
  if (r.status === 'pending') {
    return r.me === 'opponent' ? { text: 'Te retó', tone: 'go' } : { text: 'Esperando que acepte', tone: 'wait' };
  }
  if (r.status === 'finished') {
    const o = outcomeOf(r);
    return o === 'win' ? { text: 'Ganaste', tone: 'win' } : o === 'loss' ? { text: 'Perdiste', tone: 'loss' } : { text: 'Empate', tone: 'draw' };
  }
  if (r.status === 'declined') return { text: 'Rechazado', tone: 'off' };
  return { text: 'Caducó', tone: 'off' };
}

function RetoCard({ r, onOpen }: { r: Reto; onOpen: () => void }) {
  const rival = rivalOf(r);
  const st = statusLine(r);
  const left = r.status === 'active' || r.status === 'pending' ? leftText(r.expiresAt) : null;
  const toneClass = { go: s.toneGo, wait: s.toneWait, win: s.toneWin, loss: s.toneLoss, draw: s.toneDraw, off: s.toneOff }[st.tone];
  return (
    <button type="button" className={s.retoCard} onClick={onOpen}>
      <Avatar user={rival} size={48} />
      <span className={s.retoBody}>
        <span className={s.retoTitle}>{handle(rival)}</span>
        <span className={s.retoGame}>{GAME_NAME[r.game]}</span>
        <span className={s.retoStatusRow}>
          <span className={`${s.chip} ${toneClass}`}>{st.text}</span>
          {left && <span className={s.retoLeft}>{left}</span>}
        </span>
      </span>
      <svg className={s.chev} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 5 L16 12 L9 19" />
      </svg>
    </button>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <section className={s.section} aria-label={title}>
      <h2 className={s.sectionTitle}>
        {title} <span className={s.count}>{count}</span>
      </h2>
      {children}
    </section>
  );
}

export default function Home({
  slug,
  user,
  onOpen,
  onNew,
  onRanking,
}: {
  slug: string;
  user: MiniAppUser;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRanking: () => void;
}) {
  const [items, setItems] = useState<Reto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) {
        setError(null);
        setItems(null);
      }
      try {
        setItems(await retosService.list(slug));
        setError(null);
      } catch (e) {
        if (!silent) setError(errText(e, 'No pudimos cargar tus retos.'));
      }
    },
    [slug],
  );

  useEffect(() => {
    void load();
  }, [load]);

  usePoll(() => load(true), 8000, items !== null);

  async function answer(r: Reto, accept: boolean) {
    setBusy(r.id);
    setActionError(null);
    try {
      const next = accept ? await retosService.accept(r.id) : await retosService.decline(r.id);
      if (accept) {
        onOpen(next.id);
        return;
      }
      setItems((cur) => (cur ? cur.map((x) => (x.id === next.id ? next : x)) : cur));
    } catch (e) {
      setActionError(errText(e, 'No pudimos responder el reto. Intenta de nuevo.'));
      void load(true);
    }
    setBusy(null);
  }

  const first = firstName(user.displayName || user.username);
  const list = items ?? [];
  const toPlay = list.filter((r) => r.status === 'active' && r.yourTurn);
  const invited = list.filter((r) => r.status === 'pending' && r.me === 'opponent');
  const waiting = list.filter((r) => (r.status === 'pending' && r.me === 'challenger') || (r.status === 'active' && !r.yourTurn));
  const done = list.filter((r) => r.status === 'finished' || r.status === 'declined' || r.status === 'expired');
  const doneShown = showAll ? done : done.slice(0, FINISHED_SHOWN);

  return (
    <div className={s.wrap}>
      <header className={s.header}>
        <div className={s.brand}>
          <Logo size={38} />
          <span>Retos</span>
        </div>
        <button type="button" className={s.rankBtn} onClick={onRanking}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 4h10v5a5 5 0 0 1-10 0z M7 6H4v2a3 3 0 0 0 3 3 M17 6h3v2a3 3 0 0 1-3 3 M12 14v4 M8 21h8" />
          </svg>
          Posiciones
        </button>
      </header>

      <h1 className={s.hello}>Hola, {first}</h1>

      <button type="button" className={`${s.btn} ${s.btnPrimary} ${s.btnBlock} ${s.btnBig}`} onClick={onNew}>
        + Nuevo reto
      </button>

      {error && <ErrorBox message={error} onRetry={() => void load()} />}
      {actionError && <ErrorBox message={actionError} />}

      {items === null && !error && (
        <div role="status" aria-live="polite" className={s.stack}>
          <span className={s.srOnly}>Cargando tus retos…</span>
          <SkeletonBlock h={92} />
          <SkeletonBlock h={92} />
        </div>
      )}

      {items !== null && list.length === 0 && (
        <div className={s.empty}>
          <div className={s.emptyTitle}>Aún no tienes retos</div>
          <p className={s.muted}>Elige a alguien de la comunidad y lánzale un reto. ¡El primero siempre es el más divertido!</p>
        </div>
      )}

      <Section title="Te toca" count={toPlay.length}>
        <ul className={s.list}>
          {toPlay.map((r) => (
            <li key={r.id}>
              <RetoCard r={r} onOpen={() => onOpen(r.id)} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Te retaron" count={invited.length}>
        <ul className={s.list}>
          {invited.map((r) => (
            <li key={r.id} className={s.inviteCard}>
              <div className={s.inviteTop}>
                <Avatar user={rivalOf(r)} size={48} />
                <span className={s.retoBody}>
                  <span className={s.retoTitle}>{handle(rivalOf(r))}</span>
                  <span className={s.retoGame}>te reta a {GAME_NAME[r.game]}</span>
                  {leftText(r.expiresAt) && <span className={s.retoLeft}>{leftText(r.expiresAt)}</span>}
                </span>
              </div>
              <div className={s.inviteBtns}>
                <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => void answer(r, true)} disabled={busy === r.id}>
                  Aceptar
                </button>
                <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={() => void answer(r, false)} disabled={busy === r.id}>
                  Rechazar
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Esperando" count={waiting.length}>
        <ul className={s.list}>
          {waiting.map((r) => (
            <li key={r.id}>
              <RetoCard r={r} onOpen={() => onOpen(r.id)} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Terminados" count={done.length}>
        <ul className={s.list}>
          {doneShown.map((r) => (
            <li key={r.id}>
              <RetoCard r={r} onOpen={() => onOpen(r.id)} />
            </li>
          ))}
        </ul>
        {done.length > FINISHED_SHOWN && (
          <button type="button" className={s.linkBtn} onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Ver menos' : `Ver los ${done.length}`}
          </button>
        )}
      </Section>
    </div>
  );
}
