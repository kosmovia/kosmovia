import type { Parsed } from "./api-input.ts";
import { isUuid } from "./ids.ts";
import { USERNAME_RE } from "./validation.ts";

/**
 * Retos (migración 0015): reglas puras de los dos juegos, el flujo del reto y la
 * vista pública. SIN dinero: solo puntos por comunidad (ganar 3, empatar 1,
 * perder 0). Las usan el servidor (retos-repo.ts) y la demo (mockRetosService.ts),
 * así las dos juegan igual.
 *
 * Tres en raya (`ttt`): quien reta es X y empieza; el servidor valida de quién es
 * el turno, que la casilla esté libre, el ganador (8 líneas) y el empate (tablero lleno).
 *
 * Piedra, papel o tijera (`ppt`), al mejor de 3 (gana quien llegue a 2 rondas). Las
 * rondas empatadas se repiten, con un tope de 5 rondas: si nadie llegó a 2, gana
 * quien tenga más rondas, o es empate. Jugada justa con compromiso: cada jugada
 * se guarda oculta en el servidor (`state.rounds[i].c|o`) y NUNCA sale en una
 * respuesta hasta que las dos personas jugaron esa ronda. Para quien consulta,
 * la ronda en curso solo muestra la jugada propia y si la otra persona ya jugó
 * (`viewReto`). Es compromiso "de confianza en el servidor": la base guarda las
 * dos jugadas, pero ningún cliente puede leer la ajena.
 *
 * Caducidad (`settleDue`, se aplica al consultar o actuar): un reto pendiente
 * caduca a las 24 h; una partida activa sin jugar 24 h la gana quien no abandonó
 * (en ttt, quien no tenía el turno; en ppt, quien ya jugó la ronda en curso).
 * Si los dos abandonaron (ppt), el reto caduca sin ganador y sin puntos.
 */

export const RETO_TTL_MS = 24 * 60 * 60 * 1000;
export const POINTS = { win: 3, draw: 1, loss: 0 } as const;
export const PPT_WINS_NEEDED = 2;
export const PPT_MAX_ROUNDS = 5;

export const GAMES = ["ttt", "ppt"] as const;
export type RetoGame = (typeof GAMES)[number];
export type RetoStatus = "pending" | "active" | "finished" | "declined" | "expired";
export const PPT_CHOICES = ["piedra", "papel", "tijera"] as const;
export type PptChoice = (typeof PPT_CHOICES)[number];
export type Mark = "X" | "O";

export interface TttState {
  /** 9 casillas (0..8, de izquierda a derecha y de arriba abajo). */
  board: Array<Mark | null>;
}
/** `c`: jugada de quien reta; `o`: jugada de la persona retada. null = todavía no juega. */
export interface PptRound {
  c: PptChoice | null;
  o: PptChoice | null;
}
export interface PptState {
  rounds: PptRound[];
}
export type RetoState = TttState | PptState;

export function isGame(value: unknown): value is RetoGame {
  return value === "ttt" || value === "ppt";
}

export function isPptChoice(value: unknown): value is PptChoice {
  return typeof value === "string" && (PPT_CHOICES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// -------------------------------------------------------------- crear

export type OpponentRef = { kind: "id"; id: string } | { kind: "username"; username: string };

export interface RetoCreate {
  game: RetoGame;
  opponent: OpponentRef;
}

/** Cuerpo de POST /api/communities/[slug]/retos: `{ game, opponent }` con @usuario o id. */
export function parseRetoCreate(body: unknown): Parsed<RetoCreate> {
  if (!isRecord(body)) return { ok: false, error: "Datos inválidos." };
  if (!isGame(body.game)) return { ok: false, error: "Elige un juego: tres en raya o piedra, papel o tijera." };
  if (typeof body.opponent !== "string") return { ok: false, error: "Elige a quién retar." };
  const raw = body.opponent.trim();
  if (isUuid(raw)) return { ok: true, value: { game: body.game, opponent: { kind: "id", id: raw.toLowerCase() } } };
  const username = raw.replace(/^@/, "").toLowerCase();
  if (!USERNAME_RE.test(username)) return { ok: false, error: "Revisa el @usuario de a quien quieres retar." };
  return { ok: true, value: { game: body.game, opponent: { kind: "username", username } } };
}

export type RetoMove = { cell: number } | { choice: PptChoice };

/** Cuerpo de POST /api/retos/[id]/move: `{ cell }` (ttt, 0..8) o `{ choice }` (ppt). */
export function parseRetoMove(game: RetoGame, body: unknown): Parsed<RetoMove> {
  if (!isRecord(body)) return { ok: false, error: "Datos inválidos." };
  if (game === "ttt") {
    const cell = body.cell;
    if (typeof cell !== "number" || !Number.isInteger(cell) || cell < 0 || cell > 8) {
      return { ok: false, error: "Elige una casilla del 0 al 8." };
    }
    return { ok: true, value: { cell } };
  }
  if (!isPptChoice(body.choice)) return { ok: false, error: "Elige piedra, papel o tijera." };
  return { ok: true, value: { choice: body.choice } };
}

// ------------------------------------------------------------ estados

export function initialState(game: RetoGame): RetoState {
  return game === "ttt" ? { board: Array.from({ length: 9 }, () => null) } : { rounds: [] };
}

/** Lo guardado en la base, revisado: null si no tiene la forma del juego (nunca se confía a ciegas). */
export function normalizeState(game: RetoGame, raw: unknown): RetoState | null {
  if (!isRecord(raw)) return null;
  if (game === "ttt") {
    const b = raw.board;
    if (!Array.isArray(b) || b.length !== 9) return null;
    if (!b.every((c) => c === null || c === "X" || c === "O")) return null;
    return { board: b as Array<Mark | null> };
  }
  const r = raw.rounds;
  if (!Array.isArray(r) || r.length > PPT_MAX_ROUNDS) return null;
  const rounds: PptRound[] = [];
  for (const item of r) {
    if (!isRecord(item)) return null;
    const c = item.c ?? null;
    const o = item.o ?? null;
    if ((c !== null && !isPptChoice(c)) || (o !== null && !isPptChoice(o))) return null;
    rounds.push({ c: c as PptChoice | null, o: o as PptChoice | null });
  }
  return { rounds };
}

// ------------------------------------------------------------ tres en raya

const LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function tttWinner(board: ReadonlyArray<Mark | null>): Mark | null {
  for (const [a, b, c] of LINES) {
    const m = board[a];
    if (m !== null && m === board[b] && m === board[c]) return m;
  }
  return null;
}

export const tttFull = (board: ReadonlyArray<Mark | null>): boolean => board.every((c) => c !== null);

// ------------------------------------------------------ piedra, papel, tijera

/** 1 si `a` le gana a `b`, -1 si pierde, 0 si empatan. */
export function pptBeats(a: PptChoice, b: PptChoice): 1 | 0 | -1 {
  if (a === b) return 0;
  return (a === "piedra" && b === "tijera") || (a === "papel" && b === "piedra") || (a === "tijera" && b === "papel") ? 1 : -1;
}

const roundDone = (r: PptRound): r is { c: PptChoice; o: PptChoice } => r.c !== null && r.o !== null;

/** Rondas ganadas por cada quien (solo cuentan las rondas con las dos jugadas). */
export function pptScore(rounds: readonly PptRound[]): { challenger: number; opponent: number } {
  let challenger = 0;
  let opponent = 0;
  for (const r of rounds) {
    if (!roundDone(r)) continue;
    const v = pptBeats(r.c, r.o);
    if (v === 1) challenger++;
    else if (v === -1) opponent++;
  }
  return { challenger, opponent };
}

/** ¿Terminó el mejor de 3? `winner`: lado ganador, o null si es empate (tope de rondas sin definir). */
export function pptOutcome(rounds: readonly PptRound[]): { finished: boolean; winner: "challenger" | "opponent" | null } {
  const s = pptScore(rounds);
  if (s.challenger >= PPT_WINS_NEEDED) return { finished: true, winner: "challenger" };
  if (s.opponent >= PPT_WINS_NEEDED) return { finished: true, winner: "opponent" };
  const done = rounds.filter(roundDone).length;
  if (done >= PPT_MAX_ROUNDS) {
    return { finished: true, winner: s.challenger > s.opponent ? "challenger" : s.opponent > s.challenger ? "opponent" : null };
  }
  return { finished: false, winner: null };
}

/** La ronda en curso: la última si le falta una jugada; si no, una nueva (todavía vacía). */
function currentRound(rounds: readonly PptRound[]): { index: number; round: PptRound } {
  const last = rounds[rounds.length - 1];
  if (last && !roundDone(last)) return { index: rounds.length - 1, round: last };
  return { index: rounds.length, round: { c: null, o: null } };
}

// ------------------------------------------------------------ el reto

/** Lo que las reglas necesitan de un reto (fechas en epoch ms). */
export interface RetoCore {
  game: RetoGame;
  status: RetoStatus;
  challengerId: string;
  opponentId: string;
  turnProfileId: string | null;
  winnerId: string | null;
  state: RetoState;
  createdAt: number;
  updatedAt: number;
}

export type Side = "challenger" | "opponent";

export function sideOf(core: Pick<RetoCore, "challengerId" | "opponentId">, profileId: string): Side | null {
  if (profileId === core.challengerId) return "challenger";
  if (profileId === core.opponentId) return "opponent";
  return null;
}

export const otherId = (core: Pick<RetoCore, "challengerId" | "opponentId">, id: string): string =>
  id === core.challengerId ? core.opponentId : core.challengerId;

export type RetoCode =
  | "not_member"
  | "not_found"
  | "not_player"
  | "not_opponent"
  | "not_pending"
  | "not_active"
  | "expired"
  | "not_your_turn"
  | "cell_taken"
  | "already_played"
  | "invalid_move"
  | "invalid_input"
  | "self_challenge"
  | "opponent_not_member"
  | "opponent_not_found"
  | "already_open"
  | "quota_exceeded";

export type RetoDenied = { status: 400 | 403 | 404 | 409 | 422 | 429; code: RetoCode; error: string };

/** Cambios que el servidor guarda tras una acción. */
export interface Transition {
  status: RetoStatus;
  state: RetoState;
  turnProfileId: string | null;
  winnerId: string | null;
}

const deny = (status: RetoDenied["status"], code: RetoCode, error: string): { ok: false } & RetoDenied => ({
  ok: false,
  status,
  code,
  error,
});

export type Outcome = ({ ok: true } & Transition) | ({ ok: false } & RetoDenied);

const keep = (core: RetoCore): Transition => ({
  status: core.status,
  state: core.state,
  turnProfileId: core.turnProfileId,
  winnerId: core.winnerId,
});

/** Quien recibió el reto lo acepta. En ttt empieza quien reta; en ppt juegan a la vez (sin turno). */
export function acceptReto(core: RetoCore, actorId: string): Outcome {
  if (sideOf(core, actorId) === null) return deny(403, "not_player", "Este reto no es tuyo.");
  if (actorId !== core.opponentId) return deny(403, "not_opponent", "Solo quien recibió el reto puede aceptarlo.");
  if (core.status !== "pending") return deny(409, "not_pending", "Este reto ya no está pendiente.");
  return {
    ok: true,
    ...keep(core),
    status: "active",
    turnProfileId: core.game === "ttt" ? core.challengerId : null,
  };
}

export function declineReto(core: RetoCore, actorId: string): Outcome {
  if (sideOf(core, actorId) === null) return deny(403, "not_player", "Este reto no es tuyo.");
  if (actorId !== core.opponentId) return deny(403, "not_opponent", "Solo quien recibió el reto puede rechazarlo.");
  if (core.status !== "pending") return deny(409, "not_pending", "Este reto ya no está pendiente.");
  return { ok: true, ...keep(core), status: "declined", turnProfileId: null };
}

/** Una jugada. Valida turno, casilla libre, ronda ya jugada, ganador y empate. */
export function applyMove(core: RetoCore, actorId: string, move: RetoMove): Outcome {
  const side = sideOf(core, actorId);
  if (side === null) return deny(403, "not_player", "Este reto no es tuyo.");
  if (core.status !== "active") return deny(409, "not_active", "Este reto no está en juego.");

  if (core.game === "ttt") {
    if (!("cell" in move)) return deny(400, "invalid_move", "En tres en raya se juega con una casilla.");
    const state = core.state as TttState;
    if (core.turnProfileId !== actorId) return deny(409, "not_your_turn", "Todavía no es tu turno.");
    if (!Number.isInteger(move.cell) || move.cell < 0 || move.cell > 8) {
      return deny(400, "invalid_move", "Elige una casilla del 0 al 8.");
    }
    if (state.board[move.cell] !== null) return deny(409, "cell_taken", "Esa casilla ya está ocupada.");
    const mark: Mark = side === "challenger" ? "X" : "O";
    const board = state.board.map((c, i) => (i === move.cell ? mark : c));
    if (tttWinner(board) === mark) {
      return { ok: true, status: "finished", state: { board }, turnProfileId: null, winnerId: actorId };
    }
    if (tttFull(board)) return { ok: true, status: "finished", state: { board }, turnProfileId: null, winnerId: null };
    return { ok: true, status: "active", state: { board }, turnProfileId: otherId(core, actorId), winnerId: null };
  }

  // ppt
  if (!("choice" in move) || !isPptChoice(move.choice)) {
    return deny(400, "invalid_move", "Elige piedra, papel o tijera.");
  }
  const rounds = (core.state as PptState).rounds;
  const { index, round } = currentRound(rounds);
  const key = side === "challenger" ? "c" : "o";
  if (round[key] !== null) return deny(409, "already_played", "Ya jugaste esta ronda. Espera la jugada de tu rival.");
  const nextRounds = rounds.slice(0, index);
  nextRounds.push({ ...round, [key]: move.choice });
  const state: PptState = { rounds: nextRounds };
  const outcome = pptOutcome(nextRounds);
  if (outcome.finished) {
    const winnerId = outcome.winner === "challenger" ? core.challengerId : outcome.winner === "opponent" ? core.opponentId : null;
    return { ok: true, status: "finished", state, turnProfileId: null, winnerId };
  }
  return { ok: true, status: "active", state, turnProfileId: null, winnerId: null };
}

// ------------------------------------------------------------ caducidad

export interface Settlement {
  status: "expired" | "finished";
  winnerId: string | null;
}

/**
 * ¿Hay que cerrar este reto por tiempo? Pendiente de 24 h o más -> `expired`.
 * Activo sin jugar 24 h o más -> gana quien no abandonó (`finished`); si los dos
 * abandonaron, `expired` sin ganador.
 */
export function settleDue(core: RetoCore, now: number): Settlement | null {
  if (core.status === "pending") {
    return now - core.createdAt >= RETO_TTL_MS ? { status: "expired", winnerId: null } : null;
  }
  if (core.status !== "active" || now - core.updatedAt < RETO_TTL_MS) return null;
  if (core.game === "ttt") {
    // Abandonó quien tenía el turno.
    const idle = core.turnProfileId ?? core.challengerId;
    return { status: "finished", winnerId: otherId(core, idle) };
  }
  const { round } = currentRound((core.state as PptState).rounds);
  const cMissing = round.c === null;
  const oMissing = round.o === null;
  if (cMissing && oMissing) return { status: "expired", winnerId: null };
  return { status: "finished", winnerId: cMissing ? core.opponentId : core.challengerId };
}

/** Cuándo vence el reto por tiempo (epoch ms), o null si ya terminó. */
export function deadlineOf(core: Pick<RetoCore, "status" | "createdAt" | "updatedAt">): number | null {
  if (core.status === "pending") return core.createdAt + RETO_TTL_MS;
  if (core.status === "active") return core.updatedAt + RETO_TTL_MS;
  return null;
}

// ------------------------------------------------------------ vista pública

export interface TttView {
  board: Array<Mark | null>;
}
export interface PptView {
  /** Solo rondas con las dos jugadas ya reveladas. */
  rounds: Array<{ challenger: PptChoice; opponent: PptChoice; winner: Side | null }>;
  score: { challenger: number; opponent: number };
  /** Mejor de 3: rondas que hacen falta para ganar y tope de rondas. */
  winsNeeded: number;
  maxRounds: number;
  /**
   * La ronda en curso (solo si el reto está activo): tu jugada y si la otra
   * persona ya jugó. La jugada de la otra persona NO viaja hasta que se revela la ronda.
   */
  current: { mine: PptChoice | null; opponentPlayed: boolean } | null;
}
export type RetoView = TttView | PptView;

export interface RetoViewMeta {
  me: Side;
  yourTurn: boolean;
  expiresAt: number | null;
  state: RetoView;
}

/** Lo que `viewerId` puede ver del reto. El estado crudo nunca sale tal cual. */
export function viewReto(core: RetoCore, viewerId: string): RetoViewMeta | null {
  const me = sideOf(core, viewerId);
  if (me === null) return null;
  const expiresAt = deadlineOf(core);
  if (core.game === "ttt") {
    const state = core.state as TttState;
    return {
      me,
      yourTurn: core.status === "active" && core.turnProfileId === viewerId,
      expiresAt,
      state: { board: [...state.board] },
    };
  }
  const rounds = (core.state as PptState).rounds;
  const revealed = rounds.filter(roundDone).map((r) => {
    const v = pptBeats(r.c, r.o);
    return { challenger: r.c, opponent: r.o, winner: (v === 1 ? "challenger" : v === -1 ? "opponent" : null) as Side | null };
  });
  const active = core.status === "active";
  const { round } = currentRound(rounds);
  const mineKey = me === "challenger" ? "c" : "o";
  const theirKey = me === "challenger" ? "o" : "c";
  const current = active ? { mine: round[mineKey], opponentPlayed: round[theirKey] !== null } : null;
  return {
    me,
    yourTurn: active && current !== null && current.mine === null,
    expiresAt,
    state: {
      rounds: revealed,
      score: pptScore(rounds),
      winsNeeded: PPT_WINS_NEEDED,
      maxRounds: PPT_MAX_ROUNDS,
      current,
    },
  };
}

// ------------------------------------------------------------ puntos

/** Puntos que gana `playerId` en un reto terminado. */
export function pointsFor(core: Pick<RetoCore, "status" | "winnerId">, playerId: string): number {
  if (core.status !== "finished") return 0;
  if (core.winnerId === null) return POINTS.draw;
  return core.winnerId === playerId ? POINTS.win : POINTS.loss;
}
