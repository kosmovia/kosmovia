/**
 * Retos: juegos simples entre amigos de una comunidad. Contrato compartido entre
 * la UI y el backend. SIN dinero en juego: solo puntos por comunidad (ganar 3,
 * empatar 1, perder 0).
 *
 * Juegos: tres en raya (`ttt`) y piedra, papel o tijera al mejor de 3 (`ppt`).
 *
 * Flujo: A reta a B (los dos miembros de la comunidad) -> B acepta o rechaza ->
 * juegan por turnos asincrónicos -> resultado. La UI consulta `get(id)` cada pocos
 * segundos mientras el reto está abierto.
 *
 * - `ttt`: quien reta es X y empieza. `yourTurn` dice si te toca. `move({ cell })`, cell 0..8
 *   (izquierda a derecha, arriba abajo). El servidor valida turno, casilla libre, ganador y empate.
 * - `ppt`: las dos personas juegan a la vez cada ronda, no hay turno. Tu jugada se guarda oculta:
 *   `state.current` solo trae TU jugada de la ronda en curso y si la otra persona ya jugó
 *   (`opponentPlayed`). La jugada de la otra persona aparece en `state.rounds` recién cuando
 *   las dos jugaron esa ronda. Gana quien llegue a 2 rondas (las rondas empatadas se repiten;
 *   tope de 5 rondas, si nadie llegó a 2 gana quien tenga más, o es empate).
 * - Caducidad: un reto pendiente caduca a las 24 h (`expired`). Una partida sin jugar durante 24 h
 *   la gana quien no abandonó; si abandonaron las dos personas (ppt), caduca sin ganador y sin puntos.
 *   `expiresAt` dice cuándo vence el reto abierto.
 * - Cuotas: máximo 10 retos pendientes por perfil y 30 creados por hora. Un solo reto abierto
 *   por pareja y juego en cada comunidad.
 */
import type { User } from '../types';

export type RetoGame = 'ttt' | 'ppt';
export type RetoStatus = 'pending' | 'active' | 'finished' | 'declined' | 'expired';
export type PptChoice = 'piedra' | 'papel' | 'tijera';
/** De qué lado juega quien consulta: `challenger` (quien retó) u `opponent` (quien recibió el reto). */
export type RetoSide = 'challenger' | 'opponent';

export interface TttState {
  /** 9 casillas: 'X' (quien retó), 'O' (el retado) o null si está libre. */
  board: Array<'X' | 'O' | null>;
}

export interface PptState {
  /** Rondas ya reveladas (las dos jugaron). `winner` es null si empataron. */
  rounds: Array<{ challenger: PptChoice; opponent: PptChoice; winner: RetoSide | null }>;
  /** Rondas ganadas por cada lado. */
  score: { challenger: number; opponent: number };
  /** Rondas que hacen falta para ganar (2). */
  winsNeeded: number;
  /** Tope de rondas (5). */
  maxRounds: number;
  /**
   * La ronda en curso, solo si el reto está activo: tu jugada (null si aún no juegas) y si la otra
   * persona ya jugó. Nunca trae la jugada de la otra persona.
   */
  current: { mine: PptChoice | null; opponentPlayed: boolean } | null;
}

interface RetoBase {
  id: string;
  /** En modo demo (localStorage) es el slug de la comunidad. */
  communityId: string;
  challenger: User;
  opponent: User;
  status: RetoStatus;
  /** De quién es el turno (ttt, mientras está activo); null en ppt y cuando no hay turno. */
  turnProfileId: string | null;
  /** Quien ganó; null si no terminó o si fue empate. */
  winnerId: string | null;
  /** ISO. */
  createdAt: string;
  /** ISO: última jugada o cambio de estado. */
  updatedAt: string;
  /** ISO, o null si sigue abierto. */
  finishedAt: string | null;
  /** ISO: cuándo caduca por tiempo (pendiente o activo), o null si ya terminó. */
  expiresAt: string | null;
  /** Tu lado en este reto. */
  me: RetoSide;
  /** Te toca jugar: tu turno (ttt) o aún no jugaste la ronda en curso (ppt). Solo con el reto activo. */
  yourTurn: boolean;
}

export interface TttReto extends RetoBase {
  game: 'ttt';
  state: TttState;
}

export interface PptReto extends RetoBase {
  game: 'ppt';
  state: PptState;
}

/** Discrimina por `game`: 'ttt' tiene `state.board`, 'ppt' tiene `state.rounds`. */
export type Reto = TttReto | PptReto;

export interface CreateRetoInput {
  game: RetoGame;
  /** @usuario (con o sin @) o id de la persona a retar. Tiene que ser miembro de la comunidad. */
  opponent: string;
}

/** Una jugada: `{ cell }` (0..8) en ttt, `{ choice }` en ppt. */
export type RetoMove = { cell: number } | { choice: PptChoice };

export interface RetoRankingEntry {
  /** 1 es el primero. */
  rank: number;
  user: User;
  wins: number;
  draws: number;
  losses: number;
  /** 3 por ganar, 1 por empatar. */
  points: number;
}

/** Códigos de error que la UI distingue (vienen en `RetoError.code`). */
export type RetoErrorCode =
  | 'not_member' // no eres miembro de la comunidad
  | 'not_found' // el reto (o la comunidad) no existe, o no juegas en él
  | 'not_player' // el reto no es tuyo
  | 'not_opponent' // aceptar/rechazar: solo quien recibió el reto
  | 'not_pending' // el reto ya no está pendiente
  | 'not_active' // el reto no está en juego
  | 'expired' // el reto caducó por tiempo
  | 'not_your_turn' // todavía no es tu turno
  | 'cell_taken' // esa casilla ya está ocupada
  | 'already_played' // ya jugaste esta ronda (ppt)
  | 'invalid_move' // la jugada no cabe en el juego
  | 'invalid_input' // juego u oponente inválidos (el mensaje dice cuál)
  | 'self_challenge' // no puedes retarte a ti mismo
  | 'opponent_not_found' // no existe esa persona
  | 'opponent_not_member' // esa persona no es de la comunidad
  | 'already_open' // ya hay un reto abierto con esa persona en ese juego
  | 'quota_exceeded' // 10 pendientes o 30 por hora
  | 'rate_limited'
  | 'unknown';

export class RetoError extends Error {
  code: RetoErrorCode;
  constructor(message: string, code: RetoErrorCode) {
    super(message);
    this.name = 'RetoError';
    this.code = code;
  }
}

export interface IRetosService {
  /** Mis retos en la comunidad: los que se juegan primero, luego pendientes, luego terminados recientes. Solo miembros. */
  list(communitySlug: string): Promise<Reto[]>;
  /** Un reto (solo quienes juegan). Para consultar cada pocos segundos. */
  get(id: string): Promise<Reto>;
  /** Reta a otro miembro. Lanza `RetoError`. */
  create(communitySlug: string, input: CreateRetoInput): Promise<Reto>;
  /** Solo quien recibió el reto. */
  accept(id: string): Promise<Reto>;
  /** Solo quien recibió el reto. */
  decline(id: string): Promise<Reto>;
  /** Juega. Lanza `RetoError` (turno, casilla ocupada, ronda ya jugada...). */
  move(id: string, move: RetoMove): Promise<Reto>;
  /** Tabla de posiciones de la comunidad (puntos de los retos terminados). */
  ranking(communitySlug: string): Promise<RetoRankingEntry[]>;
}
