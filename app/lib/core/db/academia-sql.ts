import type { Query } from "./sql.ts";

/**
 * SQL de Aprende Stellar (migración 0016). Constructores puros, igual que sql.ts.
 * Las consultas de las misiones leen tablas de otras funciones (PIN, pagos,
 * vaquitas) solo para leer: nunca escriben en ellas.
 */

const iso = (column: string) => `to_char(${column} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export const progressOf = (profileId: string): Query => ({
  text:
    `select lesson_id, best_score, ${iso("completed_at")} as completed_at from public.academia_progress ` +
    "where profile_id = $1 order by lesson_id",
  values: [profileId],
});

export const missionsOf = (profileId: string): Query => ({
  text: `select mission_id, ${iso("completed_at")} as completed_at from public.academia_missions where profile_id = $1 order by completed_at`,
  values: [profileId],
});

/**
 * Guarda el intento: la mejor nota nunca baja y `completed_at` se llena la primera
 * vez que se aprueba y ya no cambia. Devuelve cuándo se completó y si ya estaba
 * completada antes de este envío (la CTE `prev` ve la fila anterior).
 */
export const recordLessonAttempt = (profileId: string, lessonId: string, score: number, passed: boolean): Query => ({
  text:
    "with prev as (select completed_at from public.academia_progress where profile_id = $1 and lesson_id = $2) " +
    "insert into public.academia_progress as p (profile_id, lesson_id, best_score, completed_at) " +
    "values ($1, $2, $3::int, case when $4::boolean then now() else null end) " +
    "on conflict (profile_id, lesson_id) do update set " +
    "best_score = greatest(p.best_score, excluded.best_score), " +
    "completed_at = coalesce(p.completed_at, excluded.completed_at), updated_at = now() " +
    `returning p.best_score, ${iso("p.completed_at")} as completed_at, ` +
    "exists (select 1 from prev where prev.completed_at is not null) as was_completed",
  values: [profileId, lessonId, score, passed],
});

/** Marca la misión como cumplida. Cero filas si ya lo estaba (el XP se otorga una sola vez). */
export const insertMission = (profileId: string, missionId: string): Query => ({
  text:
    "insert into public.academia_missions (profile_id, mission_id) values ($1, $2) " +
    "on conflict (profile_id, mission_id) do nothing returning mission_id",
  values: [profileId, missionId],
});

// ---- verificación de misiones (solo lectura de datos reales)

export const hasPaymentPin = (profileId: string): Query => ({
  text: "select 1 as ok from public.payment_security where profile_id = $1 and pin_hash is not null limit 1",
  values: [profileId],
});

/** Un pago enviado desde la wallet de la sesión que pasó por la confirmación con PIN. */
export const hasVerifiedPayment = (wallet: string): Query => ({
  text: "select 1 as ok from public.payments where from_wallet = $1 and unverified = false limit 1",
  values: [wallet],
});

export const hasVaquitaContribution = (profileId: string): Query => ({
  text: "select 1 as ok from public.vaquita_contributions where contributor_id = $1 limit 1",
  values: [profileId],
});

/**
 * Tabla de posiciones de una comunidad: solo quienes siguen siendo miembros y
 * tienen XP. El XP sale de los parámetros (50 por lección, 100 por misión).
 */
export const academiaRanking = (communityId: string, limit: number, lessonXp: number, missionXp: number): Query => ({
  text:
    "select json_build_object('id', a.id, 'username', a.username, 'display_name', a.display_name, 'avatar_seed', a.avatar_seed, 'avatar_style', a.avatar_style) as profile, " +
    "coalesce(l.n, 0) as lessons_completed, coalesce(s.n, 0) as missions_completed, " +
    "(coalesce(l.n, 0) * $3::int + coalesce(s.n, 0) * $4::int) as xp " +
    "from public.members m join public.profiles a on a.id = m.profile_id " +
    "left join (select profile_id, count(*)::int as n from public.academia_progress where completed_at is not null group by profile_id) l on l.profile_id = a.id " +
    "left join (select profile_id, count(*)::int as n from public.academia_missions group by profile_id) s on s.profile_id = a.id " +
    "where m.community_id = $1 and (coalesce(l.n, 0) + coalesce(s.n, 0)) > 0 " +
    "order by xp desc, a.username asc limit $2",
  values: [communityId, limit, lessonXp, missionXp],
});
