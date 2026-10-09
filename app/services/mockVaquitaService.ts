/**
 * Modo demo de la Vaquita: el mismo contrato que el backend, con el estado en
 * localStorage. Usa las mismas reglas puras que el servidor (lib/core/vaquita-rules.ts):
 * validación de la entrada y cuándo un pago cuenta como aporte.
 *
 * Diferencias con el servidor: en la demo hay una sola persona, así que SÍ puede
 * aportar a su propia vaquita (si no, nunca se vería un aporte), y el "pago" es una
 * transacción de la billetera demo (`walletService`, por su `id`). `communityId` es el slug.
 */
import type { User, WalletTransaction } from '../types';
import { checkContribution, parseVaquitaCreate } from '../lib/core/vaquita-rules.ts';
import { MockAuthService } from './authService';
import { INITIAL_TRANSACTIONS, TEAM_MEMBERS } from './mockData';
import { storage } from './storage';
import {
  VaquitaError,
  type CreateVaquitaInput,
  type IVaquitaService,
  type Vaquita,
  type VaquitaContribution,
  type VaquitaDetail,
} from './vaquitaService';

const STORAGE_KEY = 'kosmovia_vaquitas_mock';
const TX_KEY = 'kosmovia_wallet_transactions';
const DEMO_WALLET = `G${'A'.repeat(55)}`;
const DEMO_HASH = '6be268a284eee59916485c32eadc2d89d092c1b14c60443969cb504996147181';

interface StoredContribution extends VaquitaContribution {
  paymentId: string;
}

interface MockState {
  vaquitas: Vaquita[];
  contributions: Record<string, StoredContribution[]>;
  /** Comunidades que ya recibieron la vaquita de ejemplo. */
  seeded: string[];
}

const EMPTY: MockState = { vaquitas: [], contributions: {}, seeded: [] };

const load = (): MockState => storage.get<MockState>(STORAGE_KEY, EMPTY);
const save = (state: MockState): void => storage.set(STORAGE_KEY, state);

/** La vaquita con lo recaudado y los aportantes calculados de sus aportes, como en el servidor. */
function withTotals(state: MockState, v: Vaquita): Vaquita {
  const list = state.contributions[v.id] ?? [];
  return {
    ...v,
    raisedUsdc: list.reduce((sum, c) => sum + c.amountUsdc, 0),
    contributorsCount: new Set(list.map((c) => c.contributor.id)).size,
  };
}

const stripPayment = ({ paymentId: _paymentId, ...c }: StoredContribution): VaquitaContribution => c;

function seed(state: MockState, slug: string): MockState {
  if (state.seeded.includes(slug)) return state;
  const [owner, a, b] = [TEAM_MEMBERS[1], TEAM_MEMBERS[2], TEAM_MEMBERS[3]].map((m) => m ?? TEAM_MEMBERS[0]);
  const id = `vaq-demo-${slug}`;
  const now = Date.now();
  const vaquita: Vaquita = {
    id,
    communityId: slug,
    creator: owner,
    creatorWallet: DEMO_WALLET,
    title: 'Asado del sábado',
    description: 'Carne, carbón y bebidas para el asado del equipo.',
    goalUsdc: 50,
    raisedUsdc: 0,
    contributorsCount: 0,
    deadline: new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'open',
    createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
    closedAt: null,
  };
  const mk = (n: number, who: User, amountUsdc: number, hoursAgo: number): StoredContribution => ({
    id: `vaqc-demo-${slug}-${n}`,
    paymentId: `demo-pay-${slug}-${n}`,
    contributor: who,
    amountUsdc,
    txHash: DEMO_HASH,
    createdAt: new Date(now - hoursAgo * 60 * 60 * 1000).toISOString(),
  });
  return {
    vaquitas: [...state.vaquitas, vaquita],
    contributions: { ...state.contributions, [id]: [mk(1, b, 5, 3), mk(2, a, 15, 20)] },
    seeded: [...state.seeded, slug],
  };
}

export class MockVaquitaService implements IVaquitaService {
  async list(communitySlug: string): Promise<Vaquita[]> {
    const state = seed(load(), communitySlug);
    save(state);
    const open = state.vaquitas
      .filter((v) => v.communityId === communitySlug && v.status === 'open')
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    const closed = state.vaquitas
      .filter((v) => v.communityId === communitySlug && v.status === 'closed')
      .sort((x, y) => (y.closedAt ?? '').localeCompare(x.closedAt ?? ''));
    return [...open, ...closed].map((v) => withTotals(state, v));
  }

  async get(id: string): Promise<VaquitaDetail> {
    const state = load();
    const v = state.vaquitas.find((x) => x.id === id);
    if (!v) throw new VaquitaError('Vaquita no encontrada.', 'not_found');
    const contributions = (state.contributions[id] ?? [])
      .map(stripPayment)
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    return { vaquita: withTotals(state, v), contributions };
  }

  async create(communitySlug: string, input: CreateVaquitaInput): Promise<Vaquita> {
    const parsed = parseVaquitaCreate(input, Date.now());
    if (!parsed.ok) throw new VaquitaError(parsed.error, 'invalid_input');
    const me = await new MockAuthService().getCurrentUser();
    const state = seed(load(), communitySlug);
    const open = state.vaquitas.filter((v) => v.communityId === communitySlug && v.status === 'open').length;
    if (open >= 20) {
      throw new VaquitaError('Esta comunidad ya tiene el máximo de 20 vaquitas abiertas. Cierra alguna para crear otra.', 'quota_exceeded');
    }
    const vaquita: Vaquita = {
      id: `vaq-${Date.now()}`,
      communityId: communitySlug,
      creator: me,
      creatorWallet: me.wallet ?? DEMO_WALLET,
      title: parsed.value.title,
      description: parsed.value.description,
      goalUsdc: Number(parsed.value.goalUsdc),
      raisedUsdc: 0,
      contributorsCount: 0,
      deadline: parsed.value.deadline,
      status: 'open',
      createdAt: new Date().toISOString(),
      closedAt: null,
    };
    save({ ...state, vaquitas: [...state.vaquitas, vaquita] });
    return vaquita;
  }

  async contribute(id: string, paymentId: string): Promise<{ vaquita: Vaquita; contribution: VaquitaContribution }> {
    const state = load();
    const v = state.vaquitas.find((x) => x.id === id);
    if (!v) throw new VaquitaError('Vaquita no encontrada.', 'not_found');
    const txs = storage.get<WalletTransaction[]>(TX_KEY, INITIAL_TRANSACTIONS);
    const tx = txs.find((t) => t.id === paymentId);
    if (!tx) throw new VaquitaError('No encontramos ese pago.', 'payment_not_found');
    const me = await new MockAuthService().getCurrentUser();

    const linked = Object.values(state.contributions).some((list) => list.some((c) => c.paymentId === paymentId));
    const decision = checkContribution(
      {
        // La demo tiene una sola persona: no se aplica "no aportar a la propia vaquita".
        creatorId: '',
        creatorWallet: v.creatorWallet,
        status: v.status,
        deadlineAt: v.deadline === null ? null : Date.parse(v.deadline),
        createdAt: Date.parse(v.createdAt),
      },
      {
        fromWallet: tx.type === 'sent' ? DEMO_WALLET : '',
        toWallet: v.creatorWallet,
        asset: tx.asset,
        unverified: tx.unverified === true,
        paidAt: tx.paidAt ? Date.parse(tx.paidAt) : Date.now(),
        linked,
      },
      { profileId: me.id, wallet: DEMO_WALLET },
      Date.now(),
    );
    if (!decision.ok) throw new VaquitaError(decision.error, decision.code);

    const contribution: StoredContribution = {
      id: `vaqc-${Date.now()}`,
      paymentId,
      contributor: me,
      amountUsdc: tx.amount,
      txHash: tx.hash,
      createdAt: new Date().toISOString(),
    };
    const next: MockState = {
      ...state,
      contributions: { ...state.contributions, [id]: [contribution, ...(state.contributions[id] ?? [])] },
    };
    save(next);
    return { vaquita: withTotals(next, v), contribution: stripPayment(contribution) };
  }

  async close(id: string): Promise<Vaquita> {
    const state = load();
    const v = state.vaquitas.find((x) => x.id === id);
    if (!v) throw new VaquitaError('Vaquita no encontrada.', 'not_found');
    if (v.status === 'closed') return withTotals(state, v);
    const closed: Vaquita = { ...v, status: 'closed', closedAt: new Date().toISOString() };
    save({ ...state, vaquitas: state.vaquitas.map((x) => (x.id === id ? closed : x)) });
    return withTotals(state, closed);
  }
}
