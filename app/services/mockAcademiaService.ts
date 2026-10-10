/**
 * Modo demo aparte de Aprende Stellar: el mismo contrato que el backend, con el
 * progreso en localStorage. Usa el mismo contenido y las mismas reglas
 * (lib/core/academia-rules.ts): corrección, XP una sola vez e insignias.
 *
 * Diferencia con el servidor: las misiones no se pueden verificar con datos reales
 * (no hay base de datos), así que se leen de lo que hay en la demo: el PIN de la
 * demo, los pagos de la billetera demo y las vaquitas demo.
 */
import { LESSONS, getLesson } from '../lib/core/academia-content.ts';
import {
  MISSIONS,
  MISSION_XP,
  earnedBadges,
  gradeAnswers,
  lessonXpEarned,
  parseAnswers,
  summarize,
} from '../lib/core/academia-rules.ts';
import type { WalletTransaction } from '../types';
import { INITIAL_TRANSACTIONS, TEAM_MEMBERS } from './mockData';
import { storage } from './storage';
import {
  AcademiaError,
  type AcademiaRankingEntry,
  type AcademiaSummary,
  type AnswersResult,
  type IAcademiaService,
  type LessonDetail,
  type LessonList,
  type MissionsResult,
} from './academiaService';

const STORAGE_KEY = 'kosmovia_academia_mock';
const TX_KEY = 'kosmovia_wallet_transactions';
const VAQUITAS_KEY = 'kosmovia_vaquitas_mock';
const SECURITY_KEY = 'kosmovia_security_mock';

interface MockState {
  /** lessonId -> mejor nota. */
  scores: Record<string, number>;
  /** lessonId -> ISO de cuando se completó. */
  completed: Record<string, string>;
  /** missionId -> ISO. */
  missions: Record<string, string>;
}

const load = (): MockState => storage.get<MockState>(STORAGE_KEY, { scores: {}, completed: {}, missions: {} });
const save = (s: MockState): void => storage.set(STORAGE_KEY, s);

const counts = (s: MockState) => ({ lessons: Object.keys(s.completed).length, missions: Object.keys(s.missions).length });

function summaryOf(s: MockState): AcademiaSummary {
  const c = counts(s);
  return summarize(c.lessons, c.missions);
}

/** Lo que se puede saber en la demo sobre cada misión (mejor esfuerzo). */
function missionMet(id: string): boolean {
  if (id === 'crear-pin') return storage.get<{ hash?: string | null }>(SECURITY_KEY, {}).hash != null;
  if (id === 'primer-pago') {
    return storage.get<WalletTransaction[]>(TX_KEY, INITIAL_TRANSACTIONS).some((t) => t.type === 'sent' && t.unverified !== true);
  }
  if (id === 'aportar-vaquita') {
    const state = storage.get<{ contributions?: Record<string, Array<{ id: string }>> }>(VAQUITAS_KEY, {});
    // Los aportes de ejemplo ('vaqc-demo-') no cuentan: tienen que ser de la persona.
    return Object.values(state.contributions ?? {}).some((list) => list.some((c) => !c.id.startsWith('vaqc-demo-')));
  }
  return false;
}

export class MockAcademiaService implements IAcademiaService {
  async lessons(): Promise<LessonList> {
    const s = load();
    return {
      lessons: LESSONS.map((l) => ({
        id: l.id,
        title: l.title,
        summary: l.summary,
        questionCount: l.questions.length,
        bestScore: l.id in s.scores ? s.scores[l.id] : null,
        completed: l.id in s.completed,
      })),
      summary: summaryOf(s),
    };
  }

  async getLesson(id: string): Promise<LessonDetail> {
    const lesson = getLesson(id);
    if (!lesson) throw new AcademiaError('Lección no encontrada.', 'not_found');
    const s = load();
    return {
      id: lesson.id,
      title: lesson.title,
      summary: lesson.summary,
      paragraphs: [...lesson.paragraphs],
      // Sin la respuesta correcta, igual que el servidor.
      questions: lesson.questions.map((q) => ({ text: q.text, options: [...q.options] })),
      bestScore: id in s.scores ? s.scores[id] : null,
      completed: id in s.completed,
    };
  }

  async submitAnswers(id: string, answers: number[]): Promise<AnswersResult> {
    const lesson = getLesson(id);
    if (!lesson) throw new AcademiaError('Lección no encontrada.', 'not_found');
    const parsed = parseAnswers({ answers }, lesson);
    if (!parsed.ok) throw new AcademiaError(parsed.error, 'invalid_input');

    const before = load();
    const hadBadges = earnedBadges(counts(before).lessons, counts(before).missions);
    const grade = gradeAnswers(lesson, parsed.value);
    const alreadyCompleted = id in before.completed;
    const next: MockState = {
      ...before,
      scores: { ...before.scores, [id]: Math.max(before.scores[id] ?? 0, grade.score) },
      completed: grade.passed && !alreadyCompleted ? { ...before.completed, [id]: new Date().toISOString() } : before.completed,
    };
    save(next);
    const c = counts(next);
    return {
      score: grade.score,
      total: grade.total,
      passed: grade.passed,
      xpEarned: lessonXpEarned(grade.passed, alreadyCompleted),
      corrections: grade.corrections,
      bestScore: next.scores[id],
      completed: id in next.completed,
      summary: summaryOf(next),
      newBadges: earnedBadges(c.lessons, c.missions).filter((b) => !hadBadges.includes(b)),
    };
  }

  async missions(): Promise<MissionsResult> {
    const s = load();
    const newly: string[] = [];
    const done = { ...s.missions };
    for (const m of MISSIONS) {
      if (!(m.id in done) && missionMet(m.id)) {
        done[m.id] = new Date().toISOString();
        newly.push(m.id);
      }
    }
    const next = { ...s, missions: done };
    if (newly.length > 0) save(next);
    return {
      missions: MISSIONS.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        xp: MISSION_XP,
        completed: m.id in done,
        completedAt: done[m.id] ?? null,
      })),
      summary: summaryOf(next),
      newlyCompleted: newly,
    };
  }

  async ranking(_communitySlug: string): Promise<AcademiaRankingEntry[]> {
    const s = load();
    const c = counts(s);
    const me = TEAM_MEMBERS[0];
    // Compañeros de ejemplo con algo de avance, y tú con el tuyo.
    const rows = [
      { user: TEAM_MEMBERS[1] ?? me, lessons: 5, missions: 1 },
      { user: TEAM_MEMBERS[2] ?? me, lessons: 3, missions: 0 },
      { user: me, lessons: c.lessons, missions: c.missions },
    ]
      .filter((r) => r.lessons + r.missions > 0)
      .map((r) => {
        const sm = summarize(r.lessons, r.missions);
        return {
          user: r.user,
          xp: sm.xp,
          lessonsCompleted: r.lessons,
          missionsCompleted: r.missions,
          badges: earnedBadges(r.lessons, r.missions),
        };
      })
      .sort((a, b) => b.xp - a.xp);
    return rows.map((r, i) => ({ rank: i + 1, ...r }));
  }
}
