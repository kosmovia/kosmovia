import { LESSONS, getLesson } from "../academia-content.ts";
import {
  LESSON_XP,
  MISSIONS,
  MISSION_XP,
  earnedBadges,
  gradeAnswers,
  isMissionId,
  lessonXpEarned,
  parseAnswers,
  publicLesson,
  summarize,
  totalXp,
  type Correction,
  type PublicLesson,
  type Summary,
} from "../academia-rules.ts";
import { canReadCommunity } from "../authz.ts";
import * as academiaSql from "./academia-sql.ts";
import { getPool } from "./pool.ts";
import { DbNotConfiguredError, getRole } from "./repo.ts";
import type { Query } from "./sql.ts";

/**
 * Acceso a datos de Aprende Stellar. Igual que repo.ts: queries parametrizadas,
 * la persona (y su wallet) salen de la sesión verificada, nunca del cuerpo. La
 * corrección de las respuestas y la verificación de las misiones se hacen aquí,
 * en el servidor. El XP se calcula contando lo completado (no se guarda), así que
 * un envío repetido o en paralelo no puede inflarlo. Server-only.
 */

type AuthorWire = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_seed: string | null;
  avatar_style: string | null;
};

export type AcademiaDenied = { status: 400 | 403 | 404; code: string; error: string };
export type AcademiaResult<T> = { ok: true; value: T } | { ok: false; denied: AcademiaDenied };

export type LessonListItemWire = {
  id: string;
  title: string;
  summary: string;
  question_count: number;
  /** Mejor nota (de 4), o null si nunca la intentó. */
  best_score: number | null;
  completed: boolean;
};

export type LessonProgressWire = { best_score: number | null; completed: boolean };

export type SummaryWire = {
  xp: number;
  lessons_completed: number;
  missions_completed: number;
  badges: Array<{ id: string; name: string; description: string; earned: boolean }>;
};

export type AnswersResultWire = {
  score: number;
  total: number;
  passed: boolean;
  /** 50 la primera vez que se completa la lección; 0 después. */
  xp_earned: number;
  corrections: Array<{ question: number; chosen: number; correct: number; is_correct: boolean; explanation: string }>;
  progress: LessonProgressWire;
  summary: SummaryWire;
  /** Ids de insignias ganadas con este envío. */
  new_badges: string[];
};

export type MissionWire = {
  id: string;
  title: string;
  description: string;
  xp: number;
  completed: boolean;
  completed_at: string | null;
};

export type AcademiaRankingWire = {
  profile: AuthorWire;
  xp: number;
  lessons_completed: number;
  missions_completed: number;
  badges: string[];
};

const NOT_FOUND: AcademiaDenied = { status: 404, code: "not_found", error: "Lección no encontrada." };
const NOT_MEMBER: AcademiaDenied = { status: 403, code: "not_member", error: "Únete a la comunidad para ver este contenido." };

async function run<T = Record<string, unknown>>(query: Query): Promise<T[]> {
  const pool = getPool();
  if (!pool) throw new DbNotConfiguredError();
  return (await pool.query(query.text, query.values)).rows as T[];
}

type ProgressRow = { lesson_id: string; best_score: number; completed_at: string | null };
type MissionRow = { mission_id: string; completed_at: string };

const toSummaryWire = (s: Summary): SummaryWire => ({
  xp: s.xp,
  lessons_completed: s.lessonsCompleted,
  missions_completed: s.missionsCompleted,
  badges: s.badges,
});

const lessonIds = new Set(LESSONS.map((l) => l.id));
const countLessons = (rows: ProgressRow[]) => rows.filter((r) => r.completed_at !== null && lessonIds.has(r.lesson_id)).length;
const countMissions = (rows: MissionRow[]) => rows.filter((r) => isMissionId(r.mission_id)).length;

async function currentSummary(profileId: string): Promise<{ progress: ProgressRow[]; missions: MissionRow[]; summary: Summary }> {
  const [progress, missions] = await Promise.all([
    run<ProgressRow>(academiaSql.progressOf(profileId)),
    run<MissionRow>(academiaSql.missionsOf(profileId)),
  ]);
  return { progress, missions, summary: summarize(countLessons(progress), countMissions(missions)) };
}

/** Las lecciones con mi progreso, y mi XP e insignias. */
export async function listLessons(profileId: string): Promise<{ lessons: LessonListItemWire[]; summary: SummaryWire }> {
  const { progress, summary } = await currentSummary(profileId);
  const byId = new Map(progress.map((p) => [p.lesson_id, p]));
  return {
    lessons: LESSONS.map((l) => {
      const p = byId.get(l.id);
      return {
        id: l.id,
        title: l.title,
        summary: l.summary,
        question_count: l.questions.length,
        best_score: p ? p.best_score : null,
        completed: p?.completed_at != null,
      };
    }),
    summary: toSummaryWire(summary),
  };
}

/** El texto y las preguntas SIN la respuesta correcta, más mi progreso. */
export async function getLessonDetail(
  id: string,
  profileId: string,
): Promise<AcademiaResult<{ lesson: PublicLesson; progress: LessonProgressWire }>> {
  const lesson = getLesson(id);
  if (!lesson) return { ok: false, denied: NOT_FOUND };
  const p = (await run<ProgressRow>(academiaSql.progressOf(profileId))).find((r) => r.lesson_id === id);
  return {
    ok: true,
    value: { lesson: publicLesson(lesson), progress: { best_score: p ? p.best_score : null, completed: p?.completed_at != null } },
  };
}

/** Corrige en el servidor, guarda el intento y da el XP (una sola vez por lección). */
export async function submitAnswers(id: string, profileId: string, body: unknown): Promise<AcademiaResult<AnswersResultWire>> {
  const lesson = getLesson(id);
  if (!lesson) return { ok: false, denied: NOT_FOUND };
  const parsed = parseAnswers(body, lesson);
  if (!parsed.ok) return { ok: false, denied: { status: 400, code: "invalid_input", error: parsed.error } };

  const before = await currentSummary(profileId);
  const grade = gradeAnswers(lesson, parsed.value);
  const saved = (await run<{ best_score: number; completed_at: string | null; was_completed: boolean }>(
    academiaSql.recordLessonAttempt(profileId, id, grade.score, grade.passed),
  ))[0];
  const alreadyCompleted = saved ? saved.was_completed : false;
  const xpEarned = lessonXpEarned(grade.passed, alreadyCompleted);

  const after = await currentSummary(profileId);
  const hadBadges = earnedBadges(countLessons(before.progress), countMissions(before.missions));
  const newBadges = earnedBadges(countLessons(after.progress), countMissions(after.missions)).filter((b) => !hadBadges.includes(b));

  return {
    ok: true,
    value: {
      score: grade.score,
      total: grade.total,
      passed: grade.passed,
      xp_earned: xpEarned,
      corrections: grade.corrections.map((c: Correction) => ({
        question: c.question,
        chosen: c.chosen,
        correct: c.correct,
        is_correct: c.isCorrect,
        explanation: c.explanation,
      })),
      progress: { best_score: saved ? saved.best_score : grade.score, completed: saved ? saved.completed_at !== null : false },
      summary: toSummaryWire(after.summary),
      new_badges: newBadges,
    },
  };
}

/** ¿Se cumple la misión? Consultas de solo lectura sobre datos reales; `wallet` y `profileId` son los de la sesión. */
async function missionDone(missionId: string, profileId: string, wallet: string): Promise<boolean> {
  switch (missionId) {
    case "crear-pin":
      return (await run(academiaSql.hasPaymentPin(profileId))).length > 0;
    case "primer-pago":
      return (await run(academiaSql.hasVerifiedPayment(wallet))).length > 0;
    case "aportar-vaquita":
      return (await run(academiaSql.hasVaquitaContribution(profileId))).length > 0;
    default:
      return false;
  }
}

/** Estado de las misiones. Verifica las pendientes con datos reales y otorga (una sola vez) las que ya se cumplen. */
export async function checkMissions(
  profileId: string,
  wallet: string,
): Promise<{ missions: MissionWire[]; summary: SummaryWire; newly_completed: string[] }> {
  const done = new Map((await run<MissionRow>(academiaSql.missionsOf(profileId))).map((m) => [m.mission_id, m.completed_at]));
  const newly: string[] = [];
  for (const m of MISSIONS) {
    if (done.has(m.id)) continue;
    if (!(await missionDone(m.id, profileId, wallet))) continue;
    // Cero filas = otro pedido en paralelo ya la otorgó: no cuenta como nueva.
    if ((await run(academiaSql.insertMission(profileId, m.id))).length > 0) newly.push(m.id);
  }
  const { missions: rows, summary } = await currentSummary(profileId);
  const at = new Map(rows.map((r) => [r.mission_id, r.completed_at]));
  return {
    missions: MISSIONS.map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      xp: MISSION_XP,
      completed: at.has(m.id),
      completed_at: at.get(m.id) ?? null,
    })),
    summary: toSummaryWire(summary),
    newly_completed: newly,
  };
}

/** Tabla de posiciones de la comunidad por XP (solo miembros). */
export async function academiaRanking(communityId: string, profileId: string): Promise<AcademiaResult<AcademiaRankingWire[]>> {
  if (!canReadCommunity(await getRole(communityId, profileId)).allowed) return { ok: false, denied: NOT_MEMBER };
  const rows = await run<{ profile: AuthorWire; lessons_completed: number; missions_completed: number }>(
    academiaSql.academiaRanking(communityId, 50, LESSON_XP, MISSION_XP),
  );
  return {
    ok: true,
    value: rows.map((r) => ({
      profile: r.profile,
      xp: totalXp(r.lessons_completed, r.missions_completed),
      lessons_completed: r.lessons_completed,
      missions_completed: r.missions_completed,
      badges: earnedBadges(r.lessons_completed, r.missions_completed),
    })),
  };
}
