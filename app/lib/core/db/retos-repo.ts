import { canReadCommunity, roleOf } from "../authz.ts";
import { isUuid } from "../ids.ts";
import {
  POINTS,
  acceptReto,
  applyMove,
  declineReto,
  initialState,
  normalizeState,
  parseRetoMove,
  settleDue,
  sideOf,
  viewReto,
  type OpponentRef,
  type Outcome,
  type RetoCore,
  type RetoDenied,
  type RetoGame,
  type RetoStatus,
  type RetoView,
  type Side,
} from "../retos-rules.ts";
import * as retosSql from "./retos-sql.ts";
import { getPool } from "./pool.ts";
import { DbNotConfiguredError, getProfileById, getProfileByUsername, getRole } from "./repo.ts";
import * as base from "./sql.ts";
import type { Query } from "./sql.ts";

/**
 * Acceso a datos de los Retos. Igual que repo.ts: queries parametrizadas, la
 * persona sale de la sesión verificada y los errores de la base se lanzan tal
 * cual (las rutas los traducen con `handled`). Las reglas (turno, casilla,
 * ganador, caducidad) son las de retos-rules.ts; cada acción corre en una
 * transacción con la fila del reto bloqueada, así dos jugadas a la vez no se
 * pisan. Server-only.
 *
 * Privacidad en piedra, papel o tijera: el estado guardado tiene las dos jugadas
 * en juego, pero lo que sale (`toWire`) pasa siempre por `viewReto`, que solo
 * muestra la jugada propia de la ronda en curso.
 */

type AuthorWire = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_seed: string | null;
  avatar_style: string | null;
};

type RetoRow = {
  id: string;
  community_id: string;
  game: RetoGame;
  status: RetoStatus;
  challenger_id: string;
  opponent_id: string;
  turn_profile_id: string | null;
  winner_id: string | null;
  state: unknown;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  challenger: AuthorWire;
  opponent: AuthorWire;
};

export type RetoWire = {
  id: string;
  community_id: string;
  game: RetoGame;
  status: RetoStatus;
  challenger: AuthorWire;
  opponent: AuthorWire;
  /** Quién quiere el turno (ttt). En ppt es null: las dos personas juegan a la vez. */
  turn_profile_id: string | null;
  winner_id: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  /** Cuándo caduca por tiempo (pendiente o activo), o null si ya terminó. */
  expires_at: string | null;
  /** De qué lado juega quien consulta. */
  me: Side;
  /** Es el turno de quien consulta (ttt), o todavía no jugó la ronda en curso (ppt). */
  your_turn: boolean;
  state: RetoView;
};

export type RetoRankingWire = {
  profile: AuthorWire;
  wins: number;
  draws: number;
  losses: number;
  points: number;
};

export type RetoResult<T> = { ok: true; value: T } | { ok: false; denied: RetoDenied };

const denied = (status: RetoDenied["status"], code: RetoDenied["code"], error: string): { ok: false; denied: RetoDenied } => ({
  ok: false,
  denied: { status, code, error },
});

const NOT_MEMBER = () => denied(403, "not_member", "Únete a la comunidad para ver este contenido.");
const NOT_FOUND = () => denied(404, "not_found", "Reto no encontrado.");

const LIST_LIMIT = 100;
const RANKING_LIMIT = 50;

// ------------------------------------------------------------ plomería

async function run<T = Record<string, unknown>>(query: Query): Promise<T[]> {
  const pool = getPool();
  if (!pool) throw new DbNotConfiguredError();
  return (await pool.query(query.text, query.values)).rows as T[];
}

type TxQuery = <T = Record<string, unknown>>(query: Query) => Promise<T[]>;

async function transaction<T>(fn: (query: TxQuery) => Promise<T>): Promise<T> {
  const pool = getPool();
  if (!pool) throw new DbNotConfiguredError();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(async <R,>(query: Query) => (await client.query(query.text, query.values)).rows as R[]);
    await client.query("commit");
    return result;
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      // La conexión ya se perdió: el error original es el que importa.
    }
    throw err;
  } finally {
    client.release();
  }
}

function toCore(row: RetoRow): RetoCore | null {
  const state = normalizeState(row.game, row.state);
  if (!state) return null;
  return {
    game: row.game,
    status: row.status,
    challengerId: row.challenger_id,
    opponentId: row.opponent_id,
    turnProfileId: row.turn_profile_id,
    winnerId: row.winner_id,
    state,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
  };
}

/** Lo que sale hacia `viewerId`. Nunca incluye `row.state` tal cual. */
export function toWire(row: RetoRow, viewerId: string): RetoWire | null {
  const core = toCore(row);
  const view = core ? viewReto(core, viewerId) : null;
  if (!core || !view) return null;
  return {
    id: row.id,
    community_id: row.community_id,
    game: row.game,
    status: row.status,
    challenger: row.challenger,
    opponent: row.opponent,
    turn_profile_id: row.status === "active" ? row.turn_profile_id : null,
    winner_id: row.winner_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    finished_at: row.finished_at,
    expires_at: view.expiresAt === null ? null : new Date(view.expiresAt).toISOString(),
    me: view.me,
    your_turn: view.yourTurn,
    state: view.state,
  };
}

/** Cierra por tiempo el reto si ya venció (transacción con la fila bloqueada). */
async function settleOne(id: string, now: number): Promise<void> {
  await transaction(async (query) => {
    const row = (await query<RetoRow>(retosSql.retoByIdForUpdate(id)))[0];
    const core = row ? toCore(row) : null;
    if (!row || !core) return;
    const settlement = settleDue(core, now);
    if (!settlement) return;
    await query(
      retosSql.updateReto(id, row.status, {
        status: settlement.status,
        state: core.state,
        turnProfileId: null,
        winnerId: settlement.winnerId,
      }),
    );
  });
}

async function readWire(id: string, viewerId: string): Promise<RetoWire | null> {
  const row = (await run<RetoRow>(retosSql.retoById(id)))[0];
  return row ? toWire(row, viewerId) : null;
}

// ------------------------------------------------------------ consultas

/** Mis retos en la comunidad (solo miembros). Cierra por tiempo los vencidos antes de listar. */
export async function listMyRetos(communityId: string, profileId: string): Promise<RetoResult<RetoWire[]>> {
  if (!canReadCommunity(await getRole(communityId, profileId)).allowed) return NOT_MEMBER();
  const now = Date.now();
  for (const due of await run<{ id: string }>(retosSql.dueRetoIdsFor(communityId, profileId))) {
    await settleOne(due.id, now);
  }
  const rows = await run<RetoRow>(retosSql.listMyRetos(communityId, profileId, LIST_LIMIT));
  return { ok: true, value: rows.map((r) => toWire(r, profileId)).filter((w): w is RetoWire => w !== null) };
}

/** Un reto, solo para quienes juegan (los demás reciben 404: no se revela que existe). */
export async function getReto(id: string, profileId: string): Promise<RetoResult<RetoWire>> {
  if (!isUuid(id)) return NOT_FOUND();
  let row = (await run<RetoRow>(retosSql.retoById(id)))[0];
  if (!row || sideOf({ challengerId: row.challenger_id, opponentId: row.opponent_id }, profileId) === null) return NOT_FOUND();
  if (!canReadCommunity(await getRole(row.community_id, profileId)).allowed) return NOT_MEMBER();
  const core = toCore(row);
  if (core && settleDue(core, Date.now())) {
    await settleOne(id, Date.now());
    row = (await run<RetoRow>(retosSql.retoById(id)))[0] ?? row;
  }
  const wire = toWire(row, profileId);
  return wire ? { ok: true, value: wire } : NOT_FOUND();
}

// ------------------------------------------------------------ crear

async function resolveOpponent(ref: OpponentRef): Promise<{ id: string } | null> {
  const profile = ref.kind === "id" ? await getProfileById(ref.id) : await getProfileByUsername(ref.username);
  return profile ? { id: profile.id } : null;
}

/** Crea el reto. Los dos tienen que ser miembros; la entrada ya viene validada (parseRetoCreate). */
export async function createReto(
  communityId: string,
  profileId: string,
  input: { game: RetoGame; opponent: OpponentRef },
): Promise<RetoResult<RetoWire>> {
  if (!canReadCommunity(await getRole(communityId, profileId)).allowed) return NOT_MEMBER();
  const opponent = await resolveOpponent(input.opponent);
  if (!opponent) return denied(404, "opponent_not_found", "No encontramos a esa persona.");
  if (opponent.id === profileId) return denied(400, "self_challenge", "No puedes retarte a ti mismo.");
  if (!canReadCommunity(roleOf((await run<{ role: string }>(base.memberRole(communityId, opponent.id)))[0]?.role)).allowed) {
    return denied(422, "opponent_not_member", "Esa persona no es miembro de esta comunidad.");
  }

  // Un reto vencido que nadie ha mirado no debe bloquear uno nuevo.
  const now = Date.now();
  for (const open of await run<{ id: string }>(retosSql.openRetoIdsBetween(communityId, input.game, profileId, opponent.id))) {
    await settleOne(open.id, now);
  }

  let id: string | undefined;
  try {
    id = (await run<{ id: string }>(retosSql.insertReto(communityId, input.game, profileId, opponent.id, initialState(input.game))))[0]?.id;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "23505") {
      return denied(409, "already_open", "Ya tienes un reto abierto con esa persona en este juego.");
    }
    if (e.code === "P0001" && /quota_exceeded:retos_pending/.test(e.message ?? "")) {
      return denied(429, "quota_exceeded", "Ya tienes 10 retos pendientes. Espera a que respondan o caduquen.");
    }
    if (e.code === "P0001" && /quota_exceeded:retos_per_hour/.test(e.message ?? "")) {
      return denied(429, "quota_exceeded", "Creaste muchos retos en la última hora. Intenta de nuevo más tarde.");
    }
    throw err;
  }
  if (!id) return denied(422, "opponent_not_member", "Esa persona no es miembro de esta comunidad.");
  const wire = await readWire(id, profileId);
  return wire ? { ok: true, value: wire } : NOT_FOUND();
}

// ------------------------------------------------------------ acciones

/**
 * Corre una acción sobre el reto con la fila bloqueada: revisa que quien actúa
 * juega y sigue en la comunidad, cierra por tiempo si ya venció y aplica la regla.
 */
async function act(
  id: string,
  profileId: string,
  rule: (core: RetoCore) => Outcome,
): Promise<RetoResult<RetoWire>> {
  if (!isUuid(id)) return NOT_FOUND();
  const result = await transaction<RetoResult<true>>(async (query) => {
    const row = (await query<RetoRow>(retosSql.retoByIdForUpdate(id)))[0];
    const core = row ? toCore(row) : null;
    if (!row || !core || sideOf(core, profileId) === null) return NOT_FOUND();
    const member = (await query<{ role: string }>(base.memberRole(row.community_id, profileId)))[0];
    if (!canReadCommunity(roleOf(member?.role)).allowed) return NOT_MEMBER();

    const settlement = settleDue(core, Date.now());
    if (settlement) {
      await query(
        retosSql.updateReto(id, row.status, {
          status: settlement.status,
          state: core.state,
          turnProfileId: null,
          winnerId: settlement.winnerId,
        }),
      );
      return denied(409, "expired", "Este reto ya caducó por falta de respuesta.");
    }

    const outcome = rule(core);
    if (!outcome.ok) return { ok: false, denied: { status: outcome.status, code: outcome.code, error: outcome.error } };
    const saved = await query(
      retosSql.updateReto(id, row.status, {
        status: outcome.status,
        state: outcome.state,
        turnProfileId: outcome.turnProfileId,
        winnerId: outcome.winnerId,
      }),
    );
    if (saved.length === 0) return denied(409, "not_active", "El reto cambió. Vuelve a abrirlo.");
    return { ok: true, value: true };
  });
  if (!result.ok) return result;
  const wire = await readWire(id, profileId);
  return wire ? { ok: true, value: wire } : NOT_FOUND();
}

export const acceptRetoById = (id: string, profileId: string) => act(id, profileId, (core) => acceptReto(core, profileId));
export const declineRetoById = (id: string, profileId: string) => act(id, profileId, (core) => declineReto(core, profileId));

/** Una jugada. `body` es el cuerpo del pedido: se valida contra el juego del reto (parseRetoMove). */
export function moveReto(id: string, profileId: string, body: unknown): Promise<RetoResult<RetoWire>> {
  return act(id, profileId, (core) => {
    const move = parseRetoMove(core.game, body);
    if (!move.ok) return { ok: false, status: 400, code: "invalid_move", error: move.error };
    return applyMove(core, profileId, move.value);
  });
}

// ------------------------------------------------------------ posiciones

/** Tabla de posiciones de la comunidad (solo miembros): solo retos terminados. */
export async function retosRanking(communityId: string, profileId: string): Promise<RetoResult<RetoRankingWire[]>> {
  if (!canReadCommunity(await getRole(communityId, profileId)).allowed) return NOT_MEMBER();
  const rows = await run<RetoRankingWire>(retosSql.retosRanking(communityId, RANKING_LIMIT, POINTS.win, POINTS.draw));
  return { ok: true, value: rows };
}
