'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { retosService, type PptChoice, type Reto } from '@/services';
import s from './retos.module.css';
import { Avatar, BackHeader, ErrorBox, SkeletonBlock } from './ui';
import { ShareButton, shareText } from './NewReto';
import Ttt from './Ttt';
import Ppt from './Ppt';
import { usePoll } from './usePoll';
import { GAME_NAME, errText, handle, leftText, outcomeOf, rivalOf } from './util';

const CONFETTI = Array.from({ length: 18 }, (_, i) => i);

function Result({ reto }: { reto: Reto }) {
  const o = outcomeOf(reto);
  const rival = handle(rivalOf(reto));
  const info =
    o === 'win'
      ? { title: '¡Ganaste!', text: `Le ganaste a ${rival}. Sumas 3 puntos.`, cls: s.resultWin }
      : o === 'draw'
        ? { title: 'Empate', text: 'Nadie ganó esta vez. Sumas 1 punto.', cls: s.resultDraw }
        : { title: 'Esta vez no se pudo', text: `Buena partida. ${rival} se llevó esta, la próxima puede ser tuya.`, cls: s.resultLoss };
  return (
    <div className={`${s.result} ${info.cls}`} role="status" aria-live="polite">
      {o === 'win' && (
        <div className={s.confetti} aria-hidden="true">
          {CONFETTI.map((i) => (
            <span key={i} style={{ ['--i' as string]: i }} />
          ))}
        </div>
      )}
      <div className={s.resultTitle}>{info.title}</div>
      <p>{info.text}</p>
    </div>
  );
}

export default function Game({
  id,
  slug,
  onBack,
  onRanking,
  onOpen,
}: {
  id: string;
  slug: string;
  onBack: () => void;
  onRanking: () => void;
  onOpen: (id: string) => void;
}) {
  const [reto, setReto] = useState<Reto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const inflight = useRef(false);

  const load = useCallback(
    async (silent = false) => {
      if (inflight.current) return;
      inflight.current = true;
      if (!silent) {
        setLoadError(null);
        setReto(null);
      }
      try {
        const r = await retosService.get(id);
        setReto(r);
        setOffline(false);
      } catch (e) {
        if (silent) setOffline(true);
        else setLoadError(errText(e, 'No pudimos cargar este reto.'));
      }
      inflight.current = false;
    },
    [id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const open = !!reto && (reto.status === 'active' || reto.status === 'pending');
  usePoll(() => load(true), 3000, open && !busy);

  async function run(fn: () => Promise<Reto>) {
    setBusy(true);
    setActionError(null);
    try {
      setReto(await fn());
      setOffline(false);
    } catch (e) {
      setActionError(errText(e, 'No pudimos completar la jugada. Intenta de nuevo.'));
      inflight.current = false;
      void load(true);
    }
    setBusy(false);
  }

  async function rematch() {
    if (!reto) return;
    setBusy(true);
    setActionError(null);
    try {
      const next = await retosService.create(slug, { game: reto.game, opponent: handle(rivalOf(reto)) });
      onOpen(next.id);
      return;
    } catch (e) {
      setActionError(errText(e, 'No pudimos crear la revancha. Intenta de nuevo.'));
    }
    setBusy(false);
  }

  if (loadError) {
    return (
      <div className={s.wrap}>
        <BackHeader title="Reto" onBack={onBack} />
        <ErrorBox message={loadError} onRetry={() => void load()} />
      </div>
    );
  }

  if (!reto) {
    return (
      <div className={s.wrap} role="status" aria-live="polite">
        <span className={s.srOnly}>Cargando el reto…</span>
        <BackHeader title="Reto" onBack={onBack} />
        <SkeletonBlock h={72} />
        <SkeletonBlock h={320} />
      </div>
    );
  }

  const rival = rivalOf(reto);
  const left = open ? leftText(reto.expiresAt) : null;

  return (
    <div className={s.wrap}>
      <BackHeader title={`vs ${handle(rival)}`} onBack={onBack} right={<Avatar user={rival} size={40} />} />
      <div className={s.gameLine}>
        <span className={s.strong}>{GAME_NAME[reto.game]}</span>
        {left && <span className={s.retoLeft}>{left}</span>}
      </div>

      {offline && (
        <div className={s.softNote} role="status">
          Sin conexión por ahora. Reintentando…
        </div>
      )}
      {actionError && <ErrorBox message={actionError} />}

      {reto.status === 'pending' && reto.me === 'opponent' && (
        <div className={s.panel}>
          <div className={s.panelTitle}>{handle(rival)} te retó</div>
          <p className={s.muted}>
            Juegan {GAME_NAME[reto.game]}. Sin apuestas: ganar suma 3 puntos y empatar, 1.
          </p>
          <button type="button" className={`${s.btn} ${s.btnPrimary} ${s.btnBlock} ${s.btnBig}`} disabled={busy} onClick={() => void run(() => retosService.accept(reto.id))}>
            Aceptar el reto
          </button>
          <button type="button" className={`${s.btn} ${s.btnGhost} ${s.btnBlock}`} disabled={busy} onClick={() => void run(() => retosService.decline(reto.id))}>
            Rechazar
          </button>
        </div>
      )}

      {reto.status === 'pending' && reto.me === 'challenger' && (
        <div className={s.panel}>
          <div className={s.panelTitle}>Esperando que {handle(rival)} acepte</div>
          <p className={s.muted}>Le avisaremos cuando responda. Si quieres, dale un empujón en el canal.</p>
          <ShareButton text={shareText(reto.game, rival)} />
        </div>
      )}

      {(reto.status === 'declined' || reto.status === 'expired') && (
        <div className={s.panel}>
          <div className={s.panelTitle}>{reto.status === 'declined' ? 'Reto rechazado' : 'Este reto caducó'}</div>
          <p className={s.muted}>
            {reto.status === 'declined'
              ? 'No pasa nada. Puedes retar a otra persona cuando quieras.'
              : 'Pasaron 24 horas sin respuesta, así que se cerró sin puntos para nadie.'}
          </p>
          <button type="button" className={`${s.btn} ${s.btnPrimary} ${s.btnBlock}`} onClick={onBack}>
            Volver al inicio
          </button>
        </div>
      )}

      {(reto.status === 'active' || reto.status === 'finished') && (
        <>
          {reto.status === 'finished' && <Result reto={reto} />}
          {reto.game === 'ttt' ? (
            <Ttt reto={reto} busy={busy} onMove={(cell) => void run(() => retosService.move(reto.id, { cell }))} />
          ) : (
            <Ppt reto={reto} busy={busy} onMove={(choice: PptChoice) => void run(() => retosService.move(reto.id, { choice }))} />
          )}
          {reto.status === 'finished' && (
            <div className={s.stack}>
              <button type="button" className={`${s.btn} ${s.btnPrimary} ${s.btnBlock} ${s.btnBig}`} disabled={busy} onClick={() => void rematch()}>
                {busy ? 'Creando…' : 'Revancha'}
              </button>
              <button type="button" className={`${s.btn} ${s.btnGhost} ${s.btnBlock}`} onClick={onRanking}>
                Ver tabla de posiciones
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
