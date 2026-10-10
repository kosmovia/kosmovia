import type { Parsed } from "./api-input.ts";
import { LESSONS, type Lesson } from "./academia-content.ts";

/**
 * Aprende Stellar (migración 0016): reglas puras. Corrección de los
 * cuestionarios EN EL SERVIDOR (el cliente no recibe cuál es la correcta hasta
 * que responde), XP, insignias y misiones. La demo (mockAcademiaService.ts) usa
 * estas mismas reglas.
 *
 * XP: una lección completada con 3 de 4 o más da 50 XP, una sola vez; cada misión
 * práctica da 100 XP, una sola vez. El XP no se guarda: se calcula contando lo
 * completado, así repetir un envío no lo infla. Sin dinero: solo XP e insignias.
 */

export const LESSON_XP = 50;
export const MISSION_XP = 100;
/** Respuestas correctas que hacen falta para completar una lección. */
export const PASS_SCORE = 3;

// -------------------------------------------------------------- misiones

export interface MissionDef {
  id: string;
  title: string;
  description: string;
}

/** Cada misión se verifica en el servidor con datos reales (academia-sql.ts). */
export const MISSIONS: readonly MissionDef[] = [
  {
    id: "crear-pin",
    title: "Crea tu PIN de pagos",
    description: "Configura tu PIN de pagos en Seguridad. Con él confirmas cada envío.",
  },
  {
    id: "primer-pago",
    title: "Envía tu primer pago verificado",
    description: "Envía un pago desde tu wallet confirmándolo con tu PIN.",
  },
  {
    id: "aportar-vaquita",
    title: "Aporta a una vaquita",
    description: "Aporta USDC a la vaquita de alguien de tu comunidad.",
  },
];

export const MISSION_IDS: readonly string[] = MISSIONS.map((m) => m.id);

export function isMissionId(id: string): boolean {
  return MISSION_IDS.includes(id);
}

// -------------------------------------------------------------- lecciones

export interface PublicQuestion {
  text: string;
  options: string[];
}

export interface PublicLesson {
  id: string;
  title: string;
  summary: string;
  paragraphs: string[];
  /** Sin la respuesta correcta ni la explicación. */
  questions: PublicQuestion[];
}

/** La lección tal como sale por la API: sin la respuesta correcta ni las explicaciones. */
export function publicLesson(lesson: Lesson): PublicLesson {
  return {
    id: lesson.id,
    title: lesson.title,
    summary: lesson.summary,
    paragraphs: [...lesson.paragraphs],
    questions: lesson.questions.map((q) => ({ text: q.text, options: [...q.options] })),
  };
}

/** Cuerpo de POST /api/academia/lessons/[id]/answers: `{ answers: number[] }`, una por pregunta (índice 0..3). */
export function parseAnswers(body: unknown, lesson: Lesson): Parsed<number[]> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "Datos inválidos." };
  const answers = (body as Record<string, unknown>).answers;
  if (!Array.isArray(answers) || answers.length !== lesson.questions.length) {
    return { ok: false, error: `Responde las ${lesson.questions.length} preguntas.` };
  }
  for (const a of answers) {
    if (typeof a !== "number" || !Number.isInteger(a) || a < 0 || a > 3) {
      return { ok: false, error: "Elige una de las 4 opciones en cada pregunta." };
    }
  }
  return { ok: true, value: answers as number[] };
}

export interface Correction {
  /** Índice de la pregunta. */
  question: number;
  chosen: number;
  /** Índice de la opción correcta (recién aquí se revela). */
  correct: number;
  isCorrect: boolean;
  explanation: string;
}

export interface Grade {
  score: number;
  total: number;
  passed: boolean;
  corrections: Correction[];
}

export function gradeAnswers(lesson: Lesson, answers: readonly number[]): Grade {
  const corrections = lesson.questions.map((q, i): Correction => ({
    question: i,
    chosen: answers[i],
    correct: q.correct,
    isCorrect: answers[i] === q.correct,
    explanation: q.explanation,
  }));
  const score = corrections.filter((c) => c.isCorrect).length;
  return { score, total: lesson.questions.length, passed: score >= PASS_SCORE, corrections };
}

/** XP de este envío: 50 solo si pasó y la lección no estaba completada antes. */
export function lessonXpEarned(passed: boolean, alreadyCompleted: boolean): number {
  return passed && !alreadyCompleted ? LESSON_XP : 0;
}

// -------------------------------------------------------------- XP e insignias

export function totalXp(lessonsCompleted: number, missionsCompleted: number): number {
  return lessonsCompleted * LESSON_XP + missionsCompleted * MISSION_XP;
}

export interface BadgeDef {
  id: string;
  name: string;
  description: string;
}

export const BADGES: readonly BadgeDef[] = [
  { id: "primeros-pasos", name: "Primeros pasos", description: "Completa tu primera lección." },
  { id: "conoce-stellar", name: "Conoce Stellar", description: `Completa las ${LESSONS.length} lecciones.` },
  { id: "manos-a-la-obra", name: "Manos a la obra", description: `Completa ${MISSIONS.length} misiones prácticas.` },
];

/** Ids de las insignias ganadas, según lo completado. */
export function earnedBadges(lessonsCompleted: number, missionsCompleted: number): string[] {
  const earned: string[] = [];
  if (lessonsCompleted >= 1) earned.push("primeros-pasos");
  if (lessonsCompleted >= LESSONS.length) earned.push("conoce-stellar");
  if (missionsCompleted >= MISSIONS.length) earned.push("manos-a-la-obra");
  return earned;
}

export interface Summary {
  xp: number;
  lessonsCompleted: number;
  missionsCompleted: number;
  badges: Array<BadgeDef & { earned: boolean }>;
}

export function summarize(lessonsCompleted: number, missionsCompleted: number): Summary {
  const earned = earnedBadges(lessonsCompleted, missionsCompleted);
  return {
    xp: totalXp(lessonsCompleted, missionsCompleted),
    lessonsCompleted,
    missionsCompleted,
    badges: BADGES.map((b) => ({ ...b, earned: earned.includes(b.id) })),
  };
}
