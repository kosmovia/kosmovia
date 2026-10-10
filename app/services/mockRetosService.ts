/**
 * Modo demo de los Retos: el mismo contrato que el backend, con el estado en
 * localStorage. Usa las mismas reglas puras que el servidor (lib/core/retos-rules.ts):
 * turnos, casillas, ganador, mejor de 3, caducidad y puntos.
 *
 * Diferencias con el servidor: en la demo hay una sola persona, así que el rival
 * es un compañero del equipo que acepta al instante y juega solo (al azar) justo
 * después de tu jugada. `communityId` es el slug.
 */
import type { User } from '../types';
import {
  acceptReto,
  applyMove,
  declineReto,
  deadlineOf,
  initialState,
  parseRetoCreate,
  parseRetoMove,
  pointsFor,
  settleDue,
  viewReto,
  PPT_CHOICES,
  type RetoCore,
  type RetoGame,
  type RetoState,
  type RetoStatus,
  type TttState,
  type PptState,
} from '../lib/core/retos-rules.ts';
import { MockAuthService } from './authService';
import { TEAM_MEMBERS } from './mockData';
import { storage } from './storage';
import {
  RetoError,
  type CreateRetoInput,
  type IRetosService,
  type Reto,
  type RetoMove,
  type RetoRankingEntry,
} from './retosService';

const STORAGE_KEY = 'kosmovia_retos_mock';

interface StoredReto {
  id: string;
  communityId: string;
  game: RetoGame;
  status: RetoStatus;
  challenger: User;
  opponent: User;
  turnProfileId: string | null;
  winnerId: string | null;
  state: RetoState;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
}

const load = (): StoredReto[] => storage.get<StoredReto[]>(STORAGE_KEY, []);
const save = (list: StoredReto[]): void => storage.set(STORAGE_KEY, list);

const core = (r: StoredReto): RetoCore => ({
  game: r.game,
  status: r.status,
  challengerId: r.challenger.id,
  opponentId: r.opponent.id,
  turnProfileId: r.turnProfileId,
  winnerId: r.winnerId,
  state: r.state,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

function apply(r: StoredReto, next: { status: RetoStatus; state: RetoState; turnProfileId: string | null; winnerId: string | null }, now: number): StoredReto {
  const open = next.status === 'pending' || next.status === 'active';
  return { ...r, ...next, updatedAt: now, finishedAt: open ? null : now };
}

/** Cierra por tiempo lo que ya venció, como hace el servidor al consultar. */
function settled(r: StoredReto, now: number): StoredReto {
  const s = settleDue(core(r), now);
  return s ? apply(r, { status: s.status, state: r.state, turnProfileId: null, winnerId: s.winnerId }, now) : r;
}

function toReto(r: StoredReto, meId: string): Reto {
  const c = core(r);
  const v = viewReto(c, meId);
  if (!v) throw new RetoError('Reto no encontrado.', 'not_found');
  const exp = deadlineOf(c);
  const base = {
    id: r.id,
    communityId: r.communityId,
    challenger: r.challenger,
    opponent: r.opponent,
    status: r.status,
    turnProfileId: r.status === 'active' ? r.turnProfileId : null,
    winnerId: r.winnerId,
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
    finishedAt: r.finishedAt === null ? null : new Date(r.finishedAt).toISOString(),
    expiresAt: exp === null ? null : new Date(exp).toISOString(),
    me: v.me,
    yourTurn: v.yourTurn,
  };
  return r.game === 'ttt'
    ? { ...base, game: 'ttt', state: v.state as Extract<Reto, { game: 'ttt' }>['state'] }
    : { ...base, game: 'ppt', state: v.state as unknown as Extract<Reto, { game: 'ppt' }>['state'] };
}

/** El rival de la demo juega solo si le toca. */
function botPlays(r: StoredReto, now: number): StoredReto {
  if (r.status !== 'active') return r;
  const bot = r.opponent.id;
  let move: RetoMove | null = null;
  if (r.game === 'ttt') {
    if (r.turnProfileId !== bot) return r;
    const free = (r.state as TttState).board.flatMap((c, i) => (c === null ? [i] : []));
    move = { cell: free[Math.floor(Math.random() * free.length)] };
  } else {
    move = { choice: PPT_CHOICES[Math.floor(Math.random() * PPT_CHOICES.length)] };
  }
  const out = applyMove(core(r), bot, move);
  // En ppt puede que el rival ya haya jugado la ronda: entonces no hace nada.
  return out.ok ? apply(r, out, now) : r;
}

export class MockRetosService implements IRetosService {
  private async me(): Promise<User> {
    return new MockAuthService().getCurrentUser();
  }

  private find(list: StoredReto[], id: string, meId: string): StoredReto {
    const r = list.find((x) => x.id === id);
    if (!r || (r.challenger.id !== meId && r.opponent.id !== meId)) throw new RetoError('Reto no encontrado.', 'not_found');
    return r;
  }

  async list(communitySlug: string): Promise<Reto[]> {
    const me = await this.me();
    const now = Date.now();
    const list = load().map((r) => settled(r, now));
    save(list);
    const rank = (s: RetoStatus) => (s === 'active' ? 0 : s === 'pending' ? 1 : 2);
    return list
      .filter((r) => r.communityId === communitySlug && (r.challenger.id === me.id || r.opponent.id === me.id))
      .sort((a, b) => rank(a.status) - rank(b.status) || b.updatedAt - a.updatedAt)
      .map((r) => toReto(r, me.id));
  }

  async get(id: string): Promise<Reto> {
    const me = await this.me();
    const list = load();
    const r = settled(this.find(list, id, me.id), Date.now());
    save(list.map((x) => (x.id === id ? r : x)));
    return toReto(r, me.id);
  }

  async create(communitySlug: string, input: CreateRetoInput): Promise<Reto> {
    const parsed = parseRetoCreate(input);
    if (!parsed.ok) throw new RetoError(parsed.error, 'invalid_input');
    const me = await this.me();
    const ref = parsed.value.opponent;
    const handle = ref.kind === 'username' ? ref.username : null;
    const opponent = TEAM_MEMBERS.find((m) => (ref.kind === 'id' ? m.id === ref.id : m.username.replace(/^@/, '').toLowerCase() === handle));
    if (!opponent) throw new RetoError('No encontramos a esa persona.', 'opponent_not_found');
    if (opponent.id === me.id) throw new RetoError('No puedes retarte a ti mismo.', 'self_challenge');

    const now = Date.now();
    const list = load().map((r) => settled(r, now));
    const open = list.filter((r) => r.communityId === communitySlug && (r.status === 'pending' || r.status === 'active'));
    if (open.some((r) => r.game === parsed.value.game && [r.challenger.id, r.opponent.id].includes(opponent.id))) {
      throw new RetoError('Ya tienes un reto abierto con esa persona en este juego.', 'already_open');
    }
    if (open.filter((r) => r.status === 'pending' && r.challenger.id === me.id).length >= 10) {
      throw new RetoError('Ya tienes 10 retos pendientes. Espera a que respondan o caduquen.', 'quota_exceeded');
    }

    let reto: StoredReto = {
      id: `reto-${now}-${Math.floor(Math.random() * 1e6)}`,
      communityId: communitySlug,
      game: parsed.value.game,
      status: 'pending',
      challenger: me,
      opponent,
      turnProfileId: null,
      winnerId: null,
      state: initialState(parsed.value.game),
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
    };
    // En la demo el rival acepta al instante.
    const accepted = acceptReto(core(reto), opponent.id);
    if (accepted.ok) reto = apply(reto, accepted, now);
    save([...list, reto]);
    return toReto(reto, me.id);
  }

  async accept(id: string): Promise<Reto> {
    return this.act(id, (r, me, now) => {
      const out = acceptReto(core(r), me.id);
      if (!out.ok) throw new RetoError(out.error, out.code);
      return apply(r, out, now);
    });
  }

  async decline(id: string): Promise<Reto> {
    return this.act(id, (r, me, now) => {
      const out = declineReto(core(r), me.id);
      if (!out.ok) throw new RetoError(out.error, out.code);
      return apply(r, out, now);
    });
  }

  async move(id: string, move: RetoMove): Promise<Reto> {
    return this.act(id, (r, me, now) => {
      const parsed = parseRetoMove(r.game, move);
      if (!parsed.ok) throw new RetoError(parsed.error, 'invalid_move');
      const out = applyMove(core(r), me.id, parsed.value);
      if (!out.ok) throw new RetoError(out.error, out.code);
      return botPlays(apply(r, out, now), now);
    });
  }

  private async act(id: string, fn: (r: StoredReto, me: User, now: number) => StoredReto): Promise<Reto> {
    const me = await this.me();
    const now = Date.now();
    const list = load();
    const current = settled(this.find(list, id, me.id), now);
    if (current !== list.find((x) => x.id === id) && current.status !== 'pending' && current.status !== 'active') {
      save(list.map((x) => (x.id === id ? current : x)));
      throw new RetoError('Este reto ya caducó por falta de respuesta.', 'expired');
    }
    const next = fn(current, me, now);
    save(list.map((x) => (x.id === id ? next : x)));
    return toReto(next, me.id);
  }

  async ranking(communitySlug: string): Promise<RetoRankingEntry[]> {
    const table = new Map<string, { user: User; wins: number; draws: number; losses: number; points: number }>();
    const row = (u: User) => {
      let e = table.get(u.id);
      if (!e) table.set(u.id, (e = { user: u, wins: 0, draws: 0, losses: 0, points: 0 }));
      return e;
    };
    for (const r of load()) {
      if (r.communityId !== communitySlug || r.status !== 'finished') continue;
      for (const p of [r.challenger, r.opponent]) {
        const e = row(p);
        const pts = pointsFor(core(r), p.id);
        e.points += pts;
        if (r.winnerId === null) e.draws++;
        else if (r.winnerId === p.id) e.wins++;
        else e.losses++;
      }
    }
    return [...table.values()]
      .sort((a, b) => b.points - a.points || b.wins - a.wins || a.user.username.localeCompare(b.user.username))
      .map((e, i) => ({ rank: i + 1, ...e }));
  }
}
