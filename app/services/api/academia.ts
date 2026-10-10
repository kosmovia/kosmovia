/**
 * Adapter "api" de Aprende Stellar: habla con /api/academia/* y
 * /api/communities/[slug]/academia/ranking, pasa los nombres del servidor
 * (snake_case) a los del contrato y traduce los errores a `AcademiaError`.
 */
import { apiRequest } from '../../lib/core/api-client.ts';
import { renderAvatar } from '../../lib/core/avatar/generator.ts';
import type { User } from '../../types';
import {
  AcademiaError,
  type AcademiaErrorCode,
  type AcademiaRankingEntry,
  type AcademiaSummary,
  type AnswersResult,
  type IAcademiaService,
  type LessonDetail,
  type LessonList,
  type MissionsResult,
} from '../academiaService';

type AuthorWire = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_seed: string | null;
  avatar_style: string | null;
};

type SummaryWire = {
  xp: number;
  lessons_completed: number;
  missions_completed: number;
  badges: Array<{ id: string; name: string; description: string; earned: boolean }>;
};

const KNOWN_CODES: readonly AcademiaErrorCode[] = ['not_member', 'not_found', 'invalid_input'];

export function toAcademiaError(res: { status: number; error: string; code?: string }): AcademiaError {
  if (KNOWN_CODES.includes(res.code as AcademiaErrorCode)) return new AcademiaError(res.error, res.code as AcademiaErrorCode);
  return new AcademiaError(res.error, res.status === 429 ? 'rate_limited' : 'unknown');
}

async function request<T>(path: string, init?: Parameters<typeof apiRequest>[1]): Promise<T> {
  const res = await apiRequest<T>(path, init);
  if (!res.ok) throw toAcademiaError(res);
  return res.data;
}

function toPerson(a: AuthorWire): User {
  const svg = renderAvatar(a.avatar_seed || a.id, a.avatar_style);
  return {
    id: a.id,
    username: `@${a.username}`,
    displayName: a.display_name || a.username,
    avatar: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
  };
}

const toSummary = (s: SummaryWire): AcademiaSummary => ({
  xp: s.xp,
  lessonsCompleted: s.lessons_completed,
  missionsCompleted: s.missions_completed,
  badges: s.badges,
});

export class ApiAcademiaService implements IAcademiaService {
  async lessons(): Promise<LessonList> {
    const data = await request<{
      lessons: Array<{ id: string; title: string; summary: string; question_count: number; best_score: number | null; completed: boolean }>;
      summary: SummaryWire;
    }>('/api/academia/lessons');
    return {
      lessons: data.lessons.map((l) => ({
        id: l.id,
        title: l.title,
        summary: l.summary,
        questionCount: l.question_count,
        bestScore: l.best_score,
        completed: l.completed,
      })),
      summary: toSummary(data.summary),
    };
  }

  async getLesson(id: string): Promise<LessonDetail> {
    const data = await request<{
      lesson: { id: string; title: string; summary: string; paragraphs: string[]; questions: Array<{ text: string; options: string[] }> };
      progress: { best_score: number | null; completed: boolean };
    }>(`/api/academia/lessons/${encodeURIComponent(id)}`);
    return { ...data.lesson, bestScore: data.progress.best_score, completed: data.progress.completed };
  }

  async submitAnswers(id: string, answers: number[]): Promise<AnswersResult> {
    const d = await request<{
      score: number;
      total: number;
      passed: boolean;
      xp_earned: number;
      corrections: Array<{ question: number; chosen: number; correct: number; is_correct: boolean; explanation: string }>;
      progress: { best_score: number | null; completed: boolean };
      summary: SummaryWire;
      new_badges: string[];
    }>(`/api/academia/lessons/${encodeURIComponent(id)}/answers`, { method: 'POST', body: { answers } });
    return {
      score: d.score,
      total: d.total,
      passed: d.passed,
      xpEarned: d.xp_earned,
      corrections: d.corrections.map((c) => ({
        question: c.question,
        chosen: c.chosen,
        correct: c.correct,
        isCorrect: c.is_correct,
        explanation: c.explanation,
      })),
      bestScore: d.progress.best_score,
      completed: d.progress.completed,
      summary: toSummary(d.summary),
      newBadges: d.new_badges,
    };
  }

  async missions(): Promise<MissionsResult> {
    const d = await request<{
      missions: Array<{ id: string; title: string; description: string; xp: number; completed: boolean; completed_at: string | null }>;
      summary: SummaryWire;
      newly_completed: string[];
    }>('/api/academia/missions');
    return {
      missions: d.missions.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        xp: m.xp,
        completed: m.completed,
        completedAt: m.completed_at,
      })),
      summary: toSummary(d.summary),
      newlyCompleted: d.newly_completed,
    };
  }

  async ranking(communitySlug: string): Promise<AcademiaRankingEntry[]> {
    const { ranking } = await request<{
      ranking: Array<{ profile: AuthorWire; xp: number; lessons_completed: number; missions_completed: number; badges: string[] }>;
    }>(`/api/communities/${encodeURIComponent(communitySlug)}/academia/ranking`);
    return ranking.map((r, i) => ({
      rank: i + 1,
      user: toPerson(r.profile),
      xp: r.xp,
      lessonsCompleted: r.lessons_completed,
      missionsCompleted: r.missions_completed,
      badges: r.badges,
    }));
  }
}
