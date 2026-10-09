/**
 * Adapter "api" de la Vaquita: habla con /api/communities/[slug]/vaquitas y
 * /api/vaquitas/*, pasa los montos de texto (7 decimales) a número y traduce los
 * errores del servidor a `VaquitaError` con su `code`.
 */
import { apiRequest } from '../../lib/core/api-client.ts';
import { renderAvatar } from '../../lib/core/avatar/generator.ts';
import type { User } from '../../types';
import {
  VaquitaError,
  type CreateVaquitaInput,
  type IVaquitaService,
  type Vaquita,
  type VaquitaContribution,
  type VaquitaDetail,
  type VaquitaErrorCode,
} from '../vaquitaService';

type AuthorWire = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_seed: string | null;
  avatar_style: string | null;
};

export type VaquitaWire = {
  id: string;
  community_id: string;
  title: string;
  description: string | null;
  goal_usdc: string;
  raised_usdc: string;
  contributors_count: number;
  deadline: string | null;
  status: string;
  created_at: string;
  closed_at: string | null;
  creator_wallet: string;
  creator: AuthorWire;
};

export type ContributionWire = {
  id: string;
  amount_usdc: string;
  tx_hash: string;
  created_at: string;
  contributor: AuthorWire;
};

const KNOWN_CODES: readonly VaquitaErrorCode[] = [
  'not_member',
  'not_found',
  'forbidden',
  'own_vaquita',
  'closed',
  'payment_not_found',
  'payment_mismatch',
  'payment_unverified',
  'already_linked',
  'invalid_input',
  'quota_exceeded',
];

export function toVaquitaError(res: { status: number; error: string; code?: string }): VaquitaError {
  if (KNOWN_CODES.includes(res.code as VaquitaErrorCode)) return new VaquitaError(res.error, res.code as VaquitaErrorCode);
  return new VaquitaError(res.error, res.status === 429 ? 'rate_limited' : 'unknown');
}

async function request<T>(path: string, init?: Parameters<typeof apiRequest>[1]): Promise<T> {
  const res = await apiRequest<T>(path, init);
  if (!res.ok) throw toVaquitaError(res);
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

export function toVaquita(w: VaquitaWire): Vaquita {
  return {
    id: w.id,
    communityId: w.community_id,
    creator: toPerson(w.creator),
    creatorWallet: w.creator_wallet,
    title: w.title,
    description: w.description,
    goalUsdc: Number(w.goal_usdc),
    raisedUsdc: Number(w.raised_usdc),
    contributorsCount: w.contributors_count,
    deadline: w.deadline,
    status: w.status === 'closed' ? 'closed' : 'open',
    createdAt: w.created_at,
    closedAt: w.closed_at,
  };
}

export function toContribution(w: ContributionWire): VaquitaContribution {
  return {
    id: w.id,
    contributor: toPerson(w.contributor),
    amountUsdc: Number(w.amount_usdc),
    txHash: w.tx_hash,
    createdAt: w.created_at,
  };
}

export class ApiVaquitaService implements IVaquitaService {
  async list(communitySlug: string): Promise<Vaquita[]> {
    const { vaquitas } = await request<{ vaquitas: VaquitaWire[] }>(`/api/communities/${encodeURIComponent(communitySlug)}/vaquitas`);
    return vaquitas.map(toVaquita);
  }

  async get(id: string): Promise<VaquitaDetail> {
    const data = await request<{ vaquita: VaquitaWire; contributions: ContributionWire[] }>(`/api/vaquitas/${encodeURIComponent(id)}`);
    return { vaquita: toVaquita(data.vaquita), contributions: data.contributions.map(toContribution) };
  }

  async create(communitySlug: string, input: CreateVaquitaInput): Promise<Vaquita> {
    const { vaquita } = await request<{ vaquita: VaquitaWire }>(`/api/communities/${encodeURIComponent(communitySlug)}/vaquitas`, {
      method: 'POST',
      body: {
        title: input.title,
        description: input.description,
        goalUsdc: input.goalUsdc,
        deadline: input.deadline,
      },
    });
    return toVaquita(vaquita);
  }

  async contribute(id: string, paymentId: string): Promise<{ vaquita: Vaquita; contribution: VaquitaContribution }> {
    const data = await request<{ vaquita: VaquitaWire; contribution: ContributionWire }>(
      `/api/vaquitas/${encodeURIComponent(id)}/contributions`,
      { method: 'POST', body: { paymentId } },
    );
    return { vaquita: toVaquita(data.vaquita), contribution: toContribution(data.contribution) };
  }

  async close(id: string): Promise<Vaquita> {
    const { vaquita } = await request<{ vaquita: VaquitaWire }>(`/api/vaquitas/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { status: 'closed' },
    });
    return toVaquita(vaquita);
  }
}
