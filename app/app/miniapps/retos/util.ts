import type { PptChoice, Reto, RetoGame } from '@/services';
import type { User } from '@/types';

export const GAME_NAME: Record<RetoGame, string> = {
  ttt: 'Tres en raya',
  ppt: 'Piedra, papel o tijera',
};

export const CHOICE_LABEL: Record<PptChoice, string> = {
  piedra: 'Piedra',
  papel: 'Papel',
  tijera: 'Tijera',
};

export const CHOICES: PptChoice[] = ['piedra', 'papel', 'tijera'];

export function handle(u: Pick<User, 'username' | 'displayName'>): string {
  const n = (u.username || u.displayName || '').trim();
  return n.startsWith('@') ? n : `@${n}`;
}

export function initial(u: Pick<User, 'displayName' | 'username'>): string {
  const name = (u.displayName || u.username).replace(/^@/, '').trim();
  return (name[0] ?? '?').toUpperCase();
}

export function rivalOf(r: Reto): User {
  return r.me === 'challenger' ? r.opponent : r.challenger;
}

export function meOf(r: Reto): User {
  return r.me === 'challenger' ? r.challenger : r.opponent;
}

export type Outcome = 'win' | 'loss' | 'draw';

export function outcomeOf(r: Reto): Outcome {
  if (r.winnerId === null) return 'draw';
  return r.winnerId === meOf(r).id ? 'win' : 'loss';
}

export function isOpen(r: Reto): boolean {
  return r.status === 'pending' || r.status === 'active';
}

export function errText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** "Vence en 5 h", "Vence en 40 min"... para el reto abierto. */
export function leftText(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'Vence en breve';
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `Vence en ${min} min`;
  return `Vence en ${Math.floor(min / 60)} h`;
}

export function firstName(name: string): string {
  const n = name.replace(/^@/, '').trim();
  return n.split(' ')[0] || n;
}

export const WIN_LINES: number[][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export function winningLine(board: Array<'X' | 'O' | null>): number[] | null {
  for (const l of WIN_LINES) {
    const [a, b, c] = l;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return l;
  }
  return null;
}
