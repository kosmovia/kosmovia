import type { Query } from "./sql.ts";

/**
 * SQL de los Retos (migración 0015). Constructores puros, igual que sql.ts: el
 * texto son constantes y `$n`; lo que viene del usuario va en `values`. Vive en
 * su propio archivo para no tocar sql.ts.
 */

const iso = (column: string) => `to_char(${column} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const person = (alias: string) =>
  `json_build_object('id', ${alias}.id, 'username', ${alias}.username, 'display_name', ${alias}.display_name, 'avatar_seed', ${alias}.avatar_seed, 'avatar_style', ${alias}.avatar_style)`;

const RETO_SELECT =
  "r.id, r.community_id, r.game, r.status, r.challenger_id, r.opponent_id, r.turn_profile_id, r.winner_id, r.state, " +
  `${iso("r.created_at")} as created_at, ${iso("r.updated_at")} as updated_at, ${iso("r.finished_at")} as finished_at, ` +
  `${person("ch")} as challenger, ${person("op")} as opponent`;
const RETO_FROM =
  "from public.retos r join public.profiles ch on ch.id = r.challenger_id join public.profiles op on op.id = r.opponent_id";

export const retoById = (id: string): Query => ({
  text: `select ${RETO_SELECT} ${RETO_FROM} where r.id = $1`,
  values: [id],
});

/** Igual, bloqueando la fila del reto hasta el final de la transacción (dos jugadas a la vez no se pisan). */
export const retoByIdForUpdate = (id: string): Query => ({
  text: `select ${RETO_SELECT} ${RETO_FROM} where r.id = $1 for update of r`,
  values: [id],
});

/** Mis retos en la comunidad: lo que se está jugando primero, luego pendientes, luego los terminados recientes. */
export const listMyRetos = (communityId: string, profileId: string, limit: number): Query => ({
  text:
    `select ${RETO_SELECT} ${RETO_FROM} where r.community_id = $1 and (r.challenger_id = $2 or r.opponent_id = $2) ` +
    "order by (case r.status when 'active' then 0 when 'pending' then 1 else 2 end), r.updated_at desc, r.id desc limit $3",
  values: [communityId, profileId, limit],
});

/** Retos abiertos (pendientes o activos) entre dos perfiles en un juego: para cerrar los vencidos antes de crear otro. */
export const openRetoIdsBetween = (communityId: string, game: string, a: string, b: string): Query => ({
  text:
    "select r.id from public.retos r where r.community_id = $1 and r.game = $2 and r.status in ('pending', 'active') " +
    "and ((r.challenger_id = $3 and r.opponent_id = $4) or (r.challenger_id = $4 and r.opponent_id = $3))",
  values: [communityId, game, a, b],
});

/** Mis retos abiertos que ya pasaron de 24 h sin moverse: candidatos a cerrar por tiempo. */
export const dueRetoIdsFor = (communityId: string, profileId: string): Query => ({
  text:
    "select r.id from public.retos r where r.community_id = $1 and (r.challenger_id = $2 or r.opponent_id = $2) " +
    "and r.status in ('pending', 'active') and " +
    "((r.status = 'pending' and r.created_at <= now() - interval '24 hours') or (r.status = 'active' and r.updated_at <= now() - interval '24 hours')) " +
    "limit 50",
  values: [communityId, profileId],
});

/**
 * Crea el reto solo si las dos personas son miembros de la comunidad (si no, cero
 * filas). El retador es la sesión; `state` ya viene armado por las reglas.
 */
export const insertReto = (communityId: string, game: string, challengerId: string, opponentId: string, state: unknown): Query => ({
  text:
    "insert into public.retos (community_id, game, challenger_id, opponent_id, state) " +
    "select $1::uuid, $2, $3::uuid, $4::uuid, $5::jsonb " +
    "where exists (select 1 from public.members m where m.community_id = $1::uuid and m.profile_id = $3::uuid) " +
    "and exists (select 1 from public.members m where m.community_id = $1::uuid and m.profile_id = $4::uuid) " +
    "returning id",
  values: [communityId, game, challengerId, opponentId, JSON.stringify(state)],
});

/**
 * Guarda lo que cambió una acción. Solo si el reto sigue en `fromStatus` (la fila
 * ya está bloqueada, esto es una segunda barrera). `finished_at` se llena al
 * pasar a un estado final.
 */
export const updateReto = (
  id: string,
  fromStatus: string,
  next: { status: string; state: unknown; turnProfileId: string | null; winnerId: string | null },
): Query => ({
  text:
    "update public.retos set status = $3, state = $4::jsonb, turn_profile_id = $5, winner_id = $6, updated_at = now(), " +
    "finished_at = case when $3 in ('pending', 'active') then null else now() end " +
    "where id = $1 and status = $2 returning id",
  values: [id, fromStatus, next.status, JSON.stringify(next.state), next.turnProfileId, next.winnerId],
});

/**
 * Tabla de posiciones de la comunidad: solo retos terminados (ganar 3, empatar 1,
 * perder 0; los que caducaron sin ganador no cuentan) y solo quienes siguen siendo
 * miembros. Los puntos salen de los parámetros, no de números en el texto.
 */
export const retosRanking = (communityId: string, limit: number, pointsWin: number, pointsDraw: number): Query => ({
  text:
    "with sides as (" +
    "select r.challenger_id as profile_id, (r.winner_id = r.challenger_id) as won, (r.winner_id is null) as drew from public.retos r " +
    "where r.community_id = $1 and r.status = 'finished' " +
    "union all " +
    "select r.opponent_id, (r.winner_id = r.opponent_id), (r.winner_id is null) from public.retos r " +
    "where r.community_id = $1 and r.status = 'finished'" +
    "), agg as (" +
    "select profile_id, count(*) filter (where won)::int as wins, count(*) filter (where drew)::int as draws, " +
    "count(*) filter (where not won and not drew)::int as losses from sides group by profile_id" +
    ") " +
    `select ${person("a")} as profile, agg.wins, agg.draws, agg.losses, ` +
    "(agg.wins * $3::int + agg.draws * $4::int) as points " +
    "from agg join public.profiles a on a.id = agg.profile_id " +
    "join public.members m on m.community_id = $1 and m.profile_id = agg.profile_id " +
    "order by points desc, agg.wins desc, a.username asc limit $2",
  values: [communityId, limit, pointsWin, pointsDraw],
});
