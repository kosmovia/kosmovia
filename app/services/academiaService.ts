/**
 * Aprende Stellar: 5 lecciones cortas con 4 preguntas cada una y 3 misiones
 * prácticas. Contrato compartido entre la UI y el backend. Sin dinero: solo XP e
 * insignias.
 *
 * - Lecciones: `getLesson(id)` trae el texto y las preguntas SIN la respuesta correcta. Se corrige
 *   en el servidor con `submitAnswers(id, answers)` (una opción 0..3 por pregunta, en orden): la
 *   respuesta trae la nota, cuál era la correcta y una explicación breve de cada pregunta.
 *   Con 3 de 4 o más la lección queda completada y da 50 XP, solo la primera vez (`xpEarned`).
 *   Se puede repetir para mejorar la nota.
 * - Misiones: se verifican en el servidor con datos reales cada vez que llamas `missions()`
 *   (PIN de pagos creado, un pago enviado y confirmado con PIN, un aporte a una vaquita). Cada
 *   una da 100 XP una sola vez; `newlyCompleted` trae las que se cumplieron en esa consulta.
 * - Insignias (por lo completado): "Primeros pasos" (1 lección), "Conoce Stellar" (5 lecciones),
 *   "Manos a la obra" (3 misiones).
 * - Posiciones: XP por comunidad, solo con miembros que ya tienen XP.
 */
import type { User } from '../types';

export interface AcademiaBadge {
  /** 'primeros-pasos' | 'conoce-stellar' | 'manos-a-la-obra' */
  id: string;
  name: string;
  description: string;
  earned: boolean;
}

export interface AcademiaSummary {
  xp: number;
  lessonsCompleted: number;
  missionsCompleted: number;
  badges: AcademiaBadge[];
}

export interface LessonListItem {
  /** 'que-es-stellar' | 'cuentas-y-claves' | 'xlm-y-usdc' | 'pagos-y-memos' | 'trustlines-y-anclas' */
  id: string;
  title: string;
  summary: string;
  questionCount: number;
  /** Mejor nota (de 4), o null si nunca la intentó. */
  bestScore: number | null;
  completed: boolean;
}

export interface LessonList {
  lessons: LessonListItem[];
  summary: AcademiaSummary;
}

export interface LessonQuestion {
  text: string;
  /** 4 opciones, sin indicar cuál es la correcta. */
  options: string[];
}

export interface LessonDetail {
  id: string;
  title: string;
  summary: string;
  /** 3 a 5 párrafos cortos. */
  paragraphs: string[];
  /** 4 preguntas. */
  questions: LessonQuestion[];
  bestScore: number | null;
  completed: boolean;
}

export interface AnswerCorrection {
  /** Índice de la pregunta. */
  question: number;
  /** Lo que elegiste (0..3). */
  chosen: number;
  /** La opción correcta (0..3). */
  correct: number;
  isCorrect: boolean;
  explanation: string;
}

export interface AnswersResult {
  score: number;
  total: number;
  /** 3 de 4 o más. */
  passed: boolean;
  /** 50 la primera vez que se completa la lección; 0 después. */
  xpEarned: number;
  corrections: AnswerCorrection[];
  bestScore: number | null;
  /** La lección ya quedó completada (en este o en un envío anterior). */
  completed: boolean;
  summary: AcademiaSummary;
  /** Ids de insignias ganadas con este envío. */
  newBadges: string[];
}

export interface Mission {
  /** 'crear-pin' | 'primer-pago' | 'aportar-vaquita' */
  id: string;
  title: string;
  description: string;
  xp: number;
  completed: boolean;
  /** ISO, o null si falta. */
  completedAt: string | null;
}

export interface MissionsResult {
  missions: Mission[];
  summary: AcademiaSummary;
  /** Ids de misiones que se cumplieron en esta consulta (dieron XP ahora). */
  newlyCompleted: string[];
}

export interface AcademiaRankingEntry {
  /** 1 es el primero. */
  rank: number;
  user: User;
  xp: number;
  lessonsCompleted: number;
  missionsCompleted: number;
  /** Ids de insignias ganadas. */
  badges: string[];
}

export type AcademiaErrorCode =
  | 'not_member' // no eres miembro de la comunidad
  | 'not_found' // la lección (o la comunidad) no existe
  | 'invalid_input' // faltan respuestas o una opción no es 0..3
  | 'rate_limited'
  | 'unknown';

export class AcademiaError extends Error {
  code: AcademiaErrorCode;
  constructor(message: string, code: AcademiaErrorCode) {
    super(message);
    this.name = 'AcademiaError';
    this.code = code;
  }
}

export interface IAcademiaService {
  /** Las lecciones con tu progreso, tu XP e insignias. */
  lessons(): Promise<LessonList>;
  /** El texto y las preguntas de una lección (sin la respuesta correcta). */
  getLesson(id: string): Promise<LessonDetail>;
  /** Envía las respuestas (una opción 0..3 por pregunta, en orden). Lo corrige el servidor. */
  submitAnswers(id: string, answers: number[]): Promise<AnswersResult>;
  /** Estado de las misiones. Verifica las pendientes con datos reales y otorga las que ya se cumplen. */
  missions(): Promise<MissionsResult>;
  /** Posiciones por XP de la comunidad. */
  ranking(communitySlug: string): Promise<AcademiaRankingEntry[]>;
}
