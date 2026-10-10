/**
 * Adapter "api" de los Retos: habla con /api/communities/[slug]/retos y /api/retos/*,
 * pasa los nombres del servidor (snake_case) a los del contrato y traduce los
 * errores a `RetoError` con su `code`.
 */
import { apiRequest } from '../../lib/core/api-client.ts';
import { renderAvatar } from '../../lib/core/avatar/generator.ts';
import type { User } from '../../types';
import {
  RetoError,
  type CreateRetoInput,
  type IRetosService,
  type PptState,
  type Reto,
  type RetoErrorCode,
  type RetoMove,
  type RetoRankingEntry,
  type TttState,
} from '../retosService';

type AuthorWire = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_seed: string | null;
  avatar_style: string | null;
};

export type RetoWire = {
  id: string;
  community_id: string;
  game: 'ttt' | 'ppt';
  status: Reto['status'];
  challenger: AuthorWire;
  opponent: AuthorWire;
  turn_profile_id: string | null;
  winner_id: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  expires_at: string | null;
  me: 'challenger' | 'opponent';
  your_turn: boolean;
  state: TttState | PptState;
};

type RankingWire = { profile: AuthorWire; wins: number; draws: number; losses: number; points: number };

const KNOWN_CODES: readonly RetoErrorCode[] = [
  'not_member',
  'not_found',
  'not_player',
  'not_opponent',
  'not_pending',
  'not_active',
  'expired',
  'not_your_turn',
  'cell_taken',
  'already_played',
  'invalid_move',
  'invalid_input',
  'self_challenge',
  'opponent_not_found',
  'opponent_not_member',
  'already_open',
  'quota_exceeded',
];

export function toRetoError(res: { status: number; error: string; code?: string }): RetoError {
  if (KNOWN_CODES.includes(res.code as RetoErrorCode)) return new RetoError(res.error, res.code as RetoErrorCode);
  return new RetoError(res.error, res.status === 429 ? 'rate_limited' : 'unknown');
}

async function request<T>(path: string, init?: Parameters<typeof apiRequest>[1]): Promise<T> {
  const res = await apiRequest<T>(path, init);
  if (!res.ok) throw toRetoError(res);
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

export function toReto(w: RetoWire): Reto {
  const base = {
    id: w.id,
    communityId: w.community_id,
    challenger: toPerson(w.challenger),
    opponent: toPerson(w.opponent),
    status: w.status,
    turnProfileId: w.turn_profile_id,
    winnerId: w.winner_id,
    createdAt: w.created_at,
    updatedAt: w.updated_at,
    finishedAt: w.finished_at,
    expiresAt: w.expires_at,
    me: w.me,
    yourTurn: w.your_turn,
  };
  return w.game === 'ttt'
    ? { ...base, game: 'ttt', state: w.state as TttState }
    : { ...base, game: 'ppt', state: w.state as PptState };
}

const slugPath = (slug: string) => `/api/communities/${encodeURIComponent(slug)}/retos`;
const idPath = (id: string) => `/api/retos/${encodeURIComponent(id)}`;

export class ApiRetosService implements IRetosService {
  async list(communitySlug: string): Promise<Reto[]> {
    const { retos } = await request<{ retos: RetoWire[] }>(slugPath(communitySlug));
    return retos.map(toReto);
  }

  async get(id: string): Promise<Reto> {
    return toReto((await request<{ reto: RetoWire }>(idPath(id))).reto);
  }

  async create(communitySlug: string, input: CreateRetoInput): Promise<Reto> {
    const { reto } = await request<{ reto: RetoWire }>(slugPath(communitySlug), {
      method: 'POST',
      body: { game: input.game, opponent: input.opponent },
    });
    return toReto(reto);
  }

  async accept(id: string): Promise<Reto> {
    return toReto((await request<{ reto: RetoWire }>(`${idPath(id)}/accept`, { method: 'POST', body: {} })).reto);
  }

  async decline(id: string): Promise<Reto> {
    return toReto((await request<{ reto: RetoWire }>(`${idPath(id)}/decline`, { method: 'POST', body: {} })).reto);
  }

  async move(id: string, move: RetoMove): Promise<Reto> {
    return toReto((await request<{ reto: RetoWire }>(`${idPath(id)}/move`, { method: 'POST', body: move })).reto);
  }

  async ranking(communitySlug: string): Promise<RetoRankingEntry[]> {
    const { ranking } = await request<{ ranking: RankingWire[] }>(`${slugPath(communitySlug)}/ranking`);
    return ranking.map((r, i) => ({
      rank: i + 1,
      user: toPerson(r.profile),
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
      points: r.points,
    }));
  }
}
