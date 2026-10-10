'use client';

import { useRef, useState } from 'react';
import type { PptChoice, PptReto } from '@/services';
import s from './retos.module.css';
import { HandIcon } from './ui';
import { CHOICES, CHOICE_LABEL, handle, rivalOf } from './util';

type Round = PptReto['state']['rounds'][number];

function roundVerdict(r: Round, me: PptReto['me']): { text: string; cls: string } {
  if (r.winner === null) return { text: 'Empate: se repite', cls: s.toneDraw };
  return r.winner === me ? { text: '¡Ganaste la ronda!', cls: s.toneWin } : { text: 'Perdiste la ronda', cls: s.toneLoss };
}

function Reveal({ round, me, rival, animate, index }: { round: Round; me: PptReto['me']; rival: string; animate: boolean; index: number }) {
  const mineChoice = round[me];
  const theirChoice = round[me === 'challenger' ? 'opponent' : 'challenger'];
  const v = roundVerdict(round, me);
  return (
    <div className={s.reveal} aria-live="polite">
      <div className={s.revealTitle}>Ronda {index}</div>
      <div className={s.revealHands}>
        <div className={`${s.hand} ${animate ? s.handIn : ''} ${round.winner === me ? s.handWin : ''}`}>
          <HandIcon choice={mineChoice} size={64} />
          <span className={s.handLabel}>Tú · {CHOICE_LABEL[mineChoice]}</span>
        </div>
        <span className={s.vs} aria-hidden="true">
          vs
        </span>
        <div className={`${s.hand} ${animate ? s.handIn2 : ''} ${round.winner !== null && round.winner !== me ? s.handWin : ''}`}>
          <HandIcon choice={theirChoice} size={64} />
          <span className={s.handLabel}>
            {rival} · {CHOICE_LABEL[theirChoice]}
          </span>
        </div>
      </div>
      <div className={`${s.chip} ${s.chipBig} ${v.cls} ${animate ? s.verdictIn : ''}`}>{v.text}</div>
    </div>
  );
}

export default function Ppt({ reto, busy, onMove }: { reto: PptReto; busy: boolean; onMove: (c: PptChoice) => void }) {
  const st = reto.state;
  const rival = handle(rivalOf(reto));
  const other = reto.me === 'challenger' ? 'opponent' : 'challenger';
  const [picked, setPicked] = useState<PptChoice | null>(null);
  const initialRounds = useRef(st.rounds.length);
  const active = reto.status === 'active';
  const cur = st.current;
  const last = st.rounds[st.rounds.length - 1];
  const animateLast = st.rounds.length > initialRounds.current;
  const sealed = active && cur && cur.mine !== null;
  const choosing = active && reto.yourTurn && !sealed;

  return (
    <div className={s.gameArea}>
      <div className={s.scoreboard} role="status" aria-label={`Marcador: tú ${st.score[reto.me]}, ${rival} ${st.score[other]}`}>
        <div className={s.scoreSide}>
          <span className={s.scoreName}>Tú</span>
          <span className={s.scoreNum}>{st.score[reto.me]}</span>
        </div>
        <span className={s.scoreDash} aria-hidden="true">
          –
        </span>
        <div className={s.scoreSide}>
          <span className={s.scoreName}>{rival}</span>
          <span className={s.scoreNum}>{st.score[other]}</span>
        </div>
      </div>
      <p className={s.scoreRule}>
        Gana quien llegue a {st.winsNeeded} rondas
        {active ? ` · Ronda ${st.rounds.length + 1} de ${st.maxRounds} como máximo` : ''}
      </p>

      {last && active && <Reveal key={st.rounds.length} round={last} me={reto.me} rival={rival} animate={animateLast} index={st.rounds.length} />}

      {choosing && (
        <>
          <div className={`${s.turn} ${s.turnMine}`} role="status">
            <span className={s.turnText}>
              <span className={s.turnMain}>Te toca</span>
              <span className={s.turnSub}>Elige tu jugada. {cur?.opponentPlayed ? `${rival} ya jugó.` : ''}</span>
            </span>
          </div>
          <div className={s.choices} role="radiogroup" aria-label="Tu jugada">
            {CHOICES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={picked === c}
                className={`${s.choice} ${picked === c ? s.choiceOn : ''}`}
                onClick={() => setPicked(c)}
                disabled={busy}
              >
                <HandIcon choice={c} size={52} />
                <span>{CHOICE_LABEL[c]}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`${s.btn} ${s.btnPrimary} ${s.btnBlock} ${s.btnBig}`}
            disabled={!picked || busy}
            onClick={() => {
              if (!picked) return;
              onMove(picked);
              setPicked(null);
            }}
          >
            {busy ? 'Sellando…' : picked ? `Jugar ${CHOICE_LABEL[picked].toLowerCase()}` : 'Elige una jugada'}
          </button>
        </>
      )}

      {sealed && cur && cur.mine && (
        <div className={s.sealed} role="status" aria-live="polite">
          <div className={s.sealedHand}>
            <HandIcon choice={cur.mine} size={56} />
          </div>
          <div className={s.turnMain}>Tu jugada está sellada 🔒 · esperando a {rival}</div>
          <p className={s.muted}>Nadie ve tu jugada hasta que juegan los dos. Vuelve cuando quieras: esta pantalla se actualiza sola.</p>
        </div>
      )}

      {!active && st.rounds.length > 0 && (
        <ol className={s.roundList} aria-label="Rondas jugadas">
          {st.rounds.map((r, i) => {
            const v = roundVerdict(r, reto.me);
            return (
              <li key={i} className={s.roundRow}>
                <span className={s.roundNum}>R{i + 1}</span>
                <span className={s.roundHands}>
                  <HandIcon choice={r[reto.me]} size={30} />
                  <span aria-hidden="true">vs</span>
                  <HandIcon choice={r[other]} size={30} />
                </span>
                <span className={`${s.chip} ${v.cls}`}>{v.text.replace('¡', '').replace('!', '')}</span>
                <span className={s.srOnly}>
                  Tú {CHOICE_LABEL[r[reto.me]]}, {rival} {CHOICE_LABEL[r[other]]}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {active && st.rounds.length > 1 && (
        <p className={s.muted}>
          Antes: {st.rounds.slice(0, -1).map((r, i) => `R${i + 1} ${r.winner === null ? 'empate' : r.winner === reto.me ? 'ganaste' : 'perdiste'}`).join(' · ')}
        </p>
      )}
    </div>
  );
}
