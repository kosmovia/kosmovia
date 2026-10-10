'use client';

import { useRef } from 'react';
import type { TttReto } from '@/services';
import s from './retos.module.css';
import { Mark } from './ui';
import { handle, rivalOf, winningLine } from './util';

const ROW_COL = (i: number) => `fila ${Math.floor(i / 3) + 1}, columna ${(i % 3) + 1}`;

export default function Ttt({ reto, busy, onMove }: { reto: TttReto; busy: boolean; onMove: (cell: number) => void }) {
  const board = reto.state.board;
  const mine: 'X' | 'O' = reto.me === 'challenger' ? 'X' : 'O';
  const active = reto.status === 'active';
  const canPlay = active && reto.yourTurn && !busy;
  const line = reto.status === 'finished' ? winningLine(board) : null;
  const rival = handle(rivalOf(reto));
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKey(e: React.KeyboardEvent, i: number) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    let next = -1;
    if (e.key === 'ArrowRight') next = col < 2 ? i + 1 : i;
    else if (e.key === 'ArrowLeft') next = col > 0 ? i - 1 : i;
    else if (e.key === 'ArrowDown') next = row < 2 ? i + 3 : i;
    else if (e.key === 'ArrowUp') next = row > 0 ? i - 3 : i;
    else if (e.key === 'Home') next = row * 3;
    else if (e.key === 'End') next = row * 3 + 2;
    if (next >= 0) {
      e.preventDefault();
      refs.current[next]?.focus();
    }
  }

  return (
    <div className={s.gameArea}>
      {active && (
        <div className={`${s.turn} ${reto.yourTurn ? s.turnMine : s.turnWait}`} role="status" aria-live="polite">
          <span className={s.turnMark} aria-hidden="true">
            <Mark kind={reto.yourTurn ? mine : mine === 'X' ? 'O' : 'X'} animate={false} />
          </span>
          <span className={s.turnText}>
            <span className={s.turnMain}>{reto.yourTurn ? 'Te toca' : `Esperando a ${rival}`}</span>
            <span className={s.turnSub}>{reto.yourTurn ? `Tú juegas con ${mine}` : `Juega con ${mine === 'X' ? 'O' : 'X'}`}</span>
          </span>
        </div>
      )}

      <div className={s.board} role="group" aria-label="Tablero de tres en raya">
        {board.map((cell, i) => {
          const free = cell === null;
          const playable = canPlay && free;
          const label = `Casilla ${i + 1}, ${ROW_COL(i)}: ${free ? (playable ? 'vacía, toca para jugar' : 'vacía') : cell === mine ? `tu ${cell}` : `${cell} de ${rival}`}`;
          return (
            <button
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              className={`${s.cell} ${playable ? s.cellPlayable : ''} ${line?.includes(i) ? s.cellWin : ''}`}
              aria-label={label}
              aria-disabled={!playable}
              onClick={() => playable && onMove(i)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {cell && <Mark kind={cell} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
