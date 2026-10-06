/**
 * Adapters "api": los mismos contratos de la capa de servicios de Victor
 * (IAuthService, ICommunityService, IChatService, IWalletService), conectados
 * al backend de esta misma app (REST en /api, sesión con cookie httpOnly
 * firmada con SEP-53, pagos con Pollar verificados en Horizon).
 */
import type { PollarClient } from '@pollar/core';
import type { Category, Channel, Community, DmThread, Message, User, WalletTransaction } from '../../types';
import type { IDmService } from '../dmService';
import type { IAuthService } from '../authService';
import type { CreateChannelInput, CreateCommunityInput, ICommunityService, UpdateChannelInput } from '../communityService';
import type { IChatService } from '../chatService';
import type { IWalletService, SendPaymentInput, WalletBalances } from '../walletService';
import type { IProfileService } from '../profileService';
import { apiRequest } from '../../lib/core/api-client.ts';
import { renderAvatar } from '../../lib/core/avatar/generator.ts';
import { fetchBalances, shortAddress } from '../../lib/core/pollar-horizon.ts';
import {
  ADDRESS_RE,
  attemptDeadlineMs,
  checkAmount,
  classifyWithPhase,
  newPaymentRef,
  paymentOptions,
  pollarAsset,
  rejectionText,
  rejectionReason,
} from '../../lib/core/payments.ts';
import { forgetPayment, rememberPayment } from '../../lib/core/payment-memory.ts';
import { openChannelLink, sendTyping } from '../../lib/core/realtime.ts';

// ------------------------------------------------------------ wire types

type ProfileRow = {
  id: string;
  wallet: string;
  username: string;
  display_name: string | null;
  avatar_seed: string | null;
  avatar_style: string | null;
  bio: string | null;
  trust_level?: number | null;
  x_handle?: string | null;
  created_at?: string | null;
};
type AuthorRow = Pick<ProfileRow, 'id' | 'username' | 'display_name' | 'avatar_seed' | 'avatar_style'>;
type CommunityRow = { id: string; slug: string; name: string; icon: string | null; description: string | null; image?: string | null };
type ChannelRow = {
  id: string;
  community_id: string;
  name: string;
  topic: string | null;
  type: string;
  category_id?: string | null;
  position?: number | null;
  visibility?: string | null;
  emoji?: string | null;
};
type CategoryRow = { id: string; name: string; position: number };
type DmThreadWire = {
  id: string;
  other: AuthorRow & { wallet?: string };
  last_message: { content: string; created_at: string; author_id: string } | null;
  unread: number;
  last_message_at?: string | null;
};
type MemberRow = { role: string; profile: ProfileRow };
type MessageWire = { id: string; channel_id: string; content: string; created_at: string; edited_at?: string | null; author: AuthorRow };
type PaymentParty = { username: string } | null;
type PaymentWire = {
  id: string;
  tx_hash: string;
  from_wallet: string;
  to_wallet: string;
  asset: 'XLM' | 'USDC';
  amount: string;
  paid_at: string;
  from_profile: PaymentParty;
  to_profile: PaymentParty;
};

class ApiError extends Error {}

async function call<T>(path: string, init?: Parameters<typeof apiRequest>[1]): Promise<T> {
  const res = await apiRequest<T>(path, init);
  if (!res.ok) throw new ApiError(res.error);
  return res.data;
}

// ------------------------------------------------------------ mappers

/** El Kosmonauta (o el avatar generado) como imagen, para los <img> de la UI. */
function avatarUri(seed: string | null, style: string | null, fallback: string): string {
  const svg = renderAvatar(seed || fallback, style);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * `role` solo para la lista de miembros (en los mensajes no se conoce). No hay
 * presencia en tiempo real todavía: solo quien está conectado sale "en línea".
 */
function toUser(
  p: AuthorRow & Partial<Pick<ProfileRow, 'bio' | 'wallet' | 'trust_level' | 'x_handle' | 'created_at'>>,
  opts: { role?: string; online?: boolean } = {},
): User {
  const level = p.trust_level === 1 || p.trust_level === 2 ? p.trust_level : 0;
  return {
    id: p.id,
    username: `@${p.username}`,
    displayName: p.display_name || p.username,
    avatar: avatarUri(p.avatar_seed, p.avatar_style, p.id),
    role:
      opts.role === 'owner' || opts.role === 'admin' || opts.role === 'moderator' || opts.role === 'member'
        ? opts.role
        : undefined,
    isOnline: opts.online ?? false,
    bio: p.bio ?? undefined,
    wallet: p.wallet,
    trustLevel: level,
    xHandle: p.x_handle ?? undefined,
    memberSince: p.created_at ?? undefined,
  };
}

function toChannel(c: ChannelRow): Channel {
  return {
    id: c.id,
    communityId: c.community_id,
    name: c.name,
    topic: c.topic ?? undefined,
    type: c.type === 'announcement' ? 'announcement' : c.type === 'payments' ? 'payments' : 'text',
    categoryId: c.category_id ?? null,
    position: c.position ?? 0,
    visibility: c.visibility === 'private' ? 'private' : 'public',
    emoji: c.emoji ?? null,
  };
}

function toCategory(k: CategoryRow): Category {
  return { id: k.id, name: k.name, position: k.position };
}

function toThread(t: DmThreadWire): DmThread {
  return {
    id: t.id,
    other: toUser(t.other),
    lastMessage: t.last_message
      ? { content: t.last_message.content, createdAt: t.last_message.created_at, authorId: t.last_message.author_id }
      : null,
    unread: t.unread ?? 0,
    lastMessageAt: t.last_message_at ?? undefined,
  };
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function toMessage(m: MessageWire): Message {
  return { id: m.id, channelId: m.channel_id, author: toUser(m.author), content: m.content, createdAt: hora(m.created_at), editedAt: m.edited_at ?? undefined };
}

// ------------------------------------------------------------ auth

export class ApiAuthService implements IAuthService {
  async getCurrentUser(): Promise<User> {
    const { profile } = await call<{ profile: ProfileRow | null }>('/api/profile');
    if (!profile) throw new ApiError('Todavía no tienes perfil.');
    return toUser(profile, { online: true });
  }

  async updateProfile(data: { displayName: string; bio: string }): Promise<User> {
    const { profile } = await call<{ profile: ProfileRow }>('/api/profile', {
      method: 'PATCH',
      body: { displayName: data.displayName, bio: data.bio },
    });
    return toUser(profile, { online: true });
  }

  /** El login real es con Pollar (app/login): aquí solo se devuelve el perfil de la sesión. */
  async login(_username: string): Promise<User> {
    return this.getCurrentUser();
  }
}

// ------------------------------------------------------------ public profiles

const WALLET_RE = /^G[A-Z2-7]{55}$/;
const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

/**
 * Perfiles públicos (GET /api/profiles/:usuario o :wallet, sin datos privados).
 * Con caché corta: abrir varias veces la misma tarjeta no repite la consulta.
 */
export class ApiProfileService implements IProfileService {
  private cache = new Map<string, { at: number; user: User | null }>();

  async getPublicProfile(handleOrWallet: string): Promise<User | null> {
    const raw = handleOrWallet.trim();
    const key = WALLET_RE.test(raw.toUpperCase()) ? raw.toUpperCase() : raw.replace(/^@/, '').toLowerCase();
    if (!WALLET_RE.test(key) && !HANDLE_RE.test(key)) return null;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.user;
    const res = await apiRequest<{ profile: ProfileRow }>(`/api/profiles/${encodeURIComponent(key)}`);
    if (!res.ok && res.status !== 404) throw new ApiError(res.error);
    const user = res.ok ? toUser(res.data.profile) : null;
    this.cache.set(key, { at: Date.now(), user });
    return user;
  }
}

// ------------------------------------------------------------ communities

export class ApiCommunityService implements ICommunityService {
  /** slug por id: las rutas de core usan el slug. */
  private slugs = new Map<string, string>();

  private async detail(c: CommunityRow): Promise<Community> {
    this.slugs.set(c.id, c.slug);
    const [{ channels, categories }, { members }] = await Promise.all([
      call<{ channels: ChannelRow[]; categories?: CategoryRow[] }>(`/api/communities/${encodeURIComponent(c.slug)}/channels`),
      call<{ members: MemberRow[] }>(`/api/communities/${encodeURIComponent(c.slug)}/members`),
    ]);
    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      icon: c.icon || c.name.trim().charAt(0).toUpperCase() || '🚀',
      image: c.image ?? undefined,
      description: c.description ?? '',
      channels: channels.map(toChannel),
      categories: (categories ?? []).map(toCategory),
      members: members.map((m) => toUser(m.profile, { role: m.role })),
    };
  }

  /**
   * Las comunidades donde eres miembro (la UI necesita canales). Si todavía no
   * estás en ninguna, te une a la primera que exista o crea "Kosmovia".
   */
  async getCommunities(): Promise<Community[]> {
    const { communities, mine } = await call<{ communities: CommunityRow[]; mine: string[] }>('/api/communities');
    communities.forEach((c) => this.slugs.set(c.id, c.slug));
    let joined = communities.filter((c) => mine.includes(c.id));
    if (joined.length === 0) {
      if (communities.length > 0) {
        await call(`/api/communities/${encodeURIComponent(communities[0].slug)}/join`, { method: 'POST' });
        joined = [communities[0]];
      } else {
        const { community } = await call<{ community: CommunityRow }>('/api/communities', {
          method: 'POST',
          body: { name: 'Kosmovia', slug: 'kosmovia', description: 'La comunidad de todos.', icon: '🚀' },
        });
        joined = [community];
      }
    }
    return Promise.all(joined.map((c) => this.detail(c)));
  }

  async getCommunityById(id: string): Promise<Community | null> {
    const list = await this.getCommunities();
    return list.find((c) => c.id === id) ?? null;
  }

  async createCommunity(input: CreateCommunityInput): Promise<Community> {
    const { community } = await call<{ community: CommunityRow }>('/api/communities', {
      method: 'POST',
      body: { name: input.name, slug: input.slug, description: input.description, icon: input.icon, image: input.image ?? null },
    });
    return this.detail(community);
  }

  async setMemberRole(communityId: string, profileId: string, role: 'admin' | 'moderator' | 'member'): Promise<User> {
    const slug = this.slugs.get(communityId);
    if (!slug) throw new ApiError('Comunidad desconocida.');
    const { member } = await call<{ member: MemberRow }>(
      `/api/communities/${encodeURIComponent(slug)}/members/${encodeURIComponent(profileId)}`,
      { method: 'PATCH', body: { role } },
    );
    return toUser(member.profile, { role: member.role });
  }

  async deleteChannel(_communityId: string, channelId: string): Promise<void> {
    await call(`/api/channels/${encodeURIComponent(channelId)}`, { method: 'DELETE' });
  }

  async deleteCommunity(communityId: string): Promise<void> {
    const slug = this.slugs.get(communityId);
    if (!slug) throw new ApiError('Comunidad desconocida.');
    await call(`/api/communities/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  }

  async joinBySlug(slug: string): Promise<void> {
    await call(`/api/communities/${encodeURIComponent(slug)}/join`, { method: 'POST' });
  }

  async updateChannelTopic(_communityId: string, channelId: string, topic: string): Promise<Channel> {
    const { channel } = await call<{ channel: ChannelRow }>(`/api/channels/${encodeURIComponent(channelId)}`, {
      method: 'PATCH',
      body: { topic },
    });
    return toChannel(channel);
  }

  async updateImage(communityId: string, image: string | null): Promise<Community> {
    const slug = this.slugs.get(communityId);
    if (!slug) throw new ApiError('Comunidad desconocida.');
    const { community } = await call<{ community: CommunityRow }>(`/api/communities/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      body: { image },
    });
    return this.detail(community);
  }

  async updateDescription(communityId: string, description: string): Promise<Community> {
    const slug = this.slugs.get(communityId);
    if (!slug) throw new ApiError('Comunidad desconocida.');
    const { community } = await call<{ community: CommunityRow }>(`/api/communities/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      body: { description },
    });
    return this.detail(community);
  }

  async createChannel(communityId: string, input: CreateChannelInput): Promise<Channel> {
    const slug = this.slugs.get(communityId);
    if (!slug) throw new ApiError('Comunidad desconocida.');
    const { channel } = await call<{ channel: ChannelRow }>(`/api/communities/${encodeURIComponent(slug)}/channels`, {
      method: 'POST',
      body: {
        name: input.name,
        topic: input.topic ?? null,
        type: input.type ?? 'text',
        ...(input.emoji ? { emoji: input.emoji } : {}),
        ...(input.categoryId ? { category_id: input.categoryId } : {}),
        ...(input.visibility ? { visibility: input.visibility } : {}),
      },
    });
    return toChannel(channel);
  }

  async updateChannel(_communityId: string, channelId: string, patch: UpdateChannelInput): Promise<Channel> {
    const body: Record<string, unknown> = {};
    if (patch.topic !== undefined) body.topic = patch.topic;
    if (patch.emoji !== undefined) body.emoji = patch.emoji;
    if (patch.categoryId !== undefined) body.category_id = patch.categoryId;
    if (patch.visibility !== undefined) body.visibility = patch.visibility;
    if (patch.position !== undefined) body.position = patch.position;
    const { channel } = await call<{ channel: ChannelRow }>(`/api/channels/${encodeURIComponent(channelId)}`, {
      method: 'PATCH',
      body,
    });
    return toChannel(channel);
  }

  async createCategory(communityId: string, name: string): Promise<Category> {
    const slug = this.slugs.get(communityId);
    if (!slug) throw new ApiError('Comunidad desconocida.');
    const { category } = await call<{ category: CategoryRow }>(`/api/communities/${encodeURIComponent(slug)}/categories`, {
      method: 'POST',
      body: { name },
    });
    return toCategory(category);
  }

  async updateCategory(_communityId: string, categoryId: string, patch: { name?: string; position?: number }): Promise<Category> {
    const { category } = await call<{ category: CategoryRow }>(`/api/categories/${encodeURIComponent(categoryId)}`, {
      method: 'PATCH',
      body: patch,
    });
    return toCategory(category);
  }

  async deleteCategory(_communityId: string, categoryId: string): Promise<void> {
    await call(`/api/categories/${encodeURIComponent(categoryId)}`, { method: 'DELETE' });
  }
}

// ------------------------------------------------------------ direct messages

const DM_POLL_MS = 3_000;

export class ApiDmService implements IDmService {
  async getThreads(): Promise<DmThread[]> {
    const { threads } = await call<{ threads: DmThreadWire[] }>('/api/dms');
    return threads.map(toThread);
  }

  async openThread(username: string): Promise<DmThread> {
    const { thread } = await call<{ thread: DmThreadWire }>('/api/dms', {
      method: 'POST',
      body: { username: username.replace(/^@/, '') },
    });
    return toThread(thread);
  }

  async getMessages(threadId: string): Promise<Message[]> {
    try {
      const { messages } = await call<{ messages: MessageWire[] }>(`/api/dms/${encodeURIComponent(threadId)}/messages`);
      return messages.map(toMessage);
    } catch {
      return [];
    }
  }

  async sendMessage(threadId: string, content: string, _author: User): Promise<Message> {
    const { message } = await call<{ message: MessageWire }>(`/api/dms/${encodeURIComponent(threadId)}/messages`, {
      method: 'POST',
      body: { content },
    });
    return toMessage(message);
  }

  async editMessage(threadId: string, messageId: string, content: string): Promise<Message> {
    const { message } = await call<{ message: MessageWire }>(
      `/api/dms/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`,
      { method: 'PATCH', body: { content } },
    );
    return toMessage(message);
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    await call(`/api/dms/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
  }

  subscribeToMessages(
    threadId: string,
    callback: (msg: Message) => void,
    onSync?: (latestPage: Message[], isFullThread: boolean) => void,
  ): () => void {
    let seen: Set<string> | null = null;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const { messages } = await call<{ messages: MessageWire[] }>(`/api/dms/${encodeURIComponent(threadId)}/messages`);
        if (stopped) return;
        const page = messages.map(toMessage);
        if (seen !== null) {
          for (const m of page) if (!seen.has(m.id)) callback(m);
          onSync?.(page, page.length < PAGE_SIZE);
        }
        seen = new Set(page.map((m) => m.id));
      } catch {
        // Se reintenta en el próximo tick.
      }
      if (!stopped) timer = setTimeout(tick, DM_POLL_MS);
    };
    let timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }
}

// ------------------------------------------------------------ chat

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POLL_MS = 2_500;
const PAGE_SIZE = 50;
/** Con Realtime vivo no hace falta preguntar seguido: esta pasada es solo red de seguridad. */
const REALTIME_SAFETY_MS = 30_000;
/** Se olvida a quien escribe si no manda otro aviso en este tiempo. */
const TYPING_EXPIRY_MS = 4_000;

export class ApiChatService implements IChatService {
  async getMessages(channelId: string): Promise<Message[]> {
    // Ids de los datos de ejemplo ('chan-1') mientras carga lo real: nada que pedir.
    if (!UUID_RE.test(channelId)) return [];
    try {
      const { messages } = await call<{ messages: MessageWire[] }>(`/api/channels/${channelId}/messages`);
      return messages.map(toMessage);
    } catch {
      return [];
    }
  }

  async sendMessage(channelId: string, content: string, _author: User): Promise<Message> {
    const { message } = await call<{ message: MessageWire }>(`/api/channels/${channelId}/messages`, {
      method: 'POST',
      body: { content },
    });
    return toMessage(message);
  }

  async editMessage(channelId: string, messageId: string, content: string): Promise<Message> {
    const { message } = await call<{ message: MessageWire }>(
      `/api/channels/${channelId}/messages/${encodeURIComponent(messageId)}`,
      { method: 'PATCH', body: { content } },
    );
    return toMessage(message);
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    await call(`/api/channels/${channelId}/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
  }

  /**
   * Mensajes en vivo. Con Supabase Realtime disponible, la base avisa y acá se
   * vuelve a pedir la última página (la API es la que sabe de autorización y de
   * autores, así que Realtime reemplaza al temporizador, no a la API). Sin
   * Realtime —o si la suscripción se cae— queda el polling de 2,5 s de siempre.
   *
   * Lo nuevo va por `callback`; la página completa por `onSync`, para ver
   * ediciones y borrados de otras personas.
   */
  subscribeToMessages(
    channelId: string,
    callback: (msg: Message) => void,
    onSync?: (latestPage: Message[], isFullChannel: boolean) => void,
  ): () => void {
    if (!UUID_RE.test(channelId)) return () => {};
    let seen: Set<string> | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fetching = false;
    let again = false;

    const refresh = async (): Promise<void> => {
      if (stopped) return;
      // Varios avisos seguidos (una ráfaga de mensajes) comparten una sola consulta.
      if (fetching) {
        again = true;
        return;
      }
      fetching = true;
      try {
        const { messages } = await call<{ messages: MessageWire[] }>(`/api/channels/${channelId}/messages`);
        if (stopped) return;
        const page = messages.map(toMessage);
        if (seen !== null) {
          for (const m of page) if (!seen.has(m.id)) callback(m);
          onSync?.(page, page.length < PAGE_SIZE);
        }
        seen = new Set(page.map((m) => m.id));
      } catch {
        // Se reintenta con el próximo aviso o en la pasada de respaldo.
      } finally {
        fetching = false;
        if (again && !stopped) {
          again = false;
          void refresh();
        }
      }
    };

    /** Con Realtime vivo, una pasada lenta de red de seguridad; sin él, el polling normal. */
    const schedule = (everyMs: number) => {
      clearTimeout(timer);
      if (stopped) return;
      timer = setTimeout(() => {
        void refresh().finally(() => schedule(everyMs));
      }, everyMs);
    };

    void refresh();
    schedule(POLL_MS);

    const link = openChannelLink(channelId, {
      onChange: () => void refresh(),
      onLive: (live) => schedule(live ? REALTIME_SAFETY_MS : POLL_MS),
    });

    return () => {
      stopped = true;
      clearTimeout(timer);
      link?.close();
    };
  }

  notifyTyping(channelId: string, profileId: string): void {
    if (!UUID_RE.test(channelId)) return;
    sendTyping(channelId, profileId);
  }

  /**
   * Quiénes escriben en el canal. Cada aviso renueva la expiración de esa
   * persona, así que no hace falta un evento de "dejé de escribir": una pestaña
   * que se cierra simplemente deja de avisar.
   */
  subscribeToTyping(channelId: string, onChange: (profileIds: string[]) => void): () => void {
    if (!UUID_RE.test(channelId)) return () => {};
    let stopped = false;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    let ids: string[] = [];

    const emit = () => {
      if (!stopped) onChange([...ids]);
    };

    const link = openChannelLink(channelId, {
      onChange: () => {},
      onTyping: (profileId) => {
        if (stopped) return;
        clearTimeout(timers.get(profileId));
        timers.set(
          profileId,
          setTimeout(() => {
            timers.delete(profileId);
            ids = ids.filter((id) => id !== profileId);
            emit();
          }, TYPING_EXPIRY_MS),
        );
        if (!ids.includes(profileId)) {
          ids = [...ids, profileId];
          emit();
        }
      },
    });

    return () => {
      stopped = true;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      link?.close();
    };
  }
}

// ------------------------------------------------------------ wallet

function pollarClient(): PollarClient | null {
  return (globalThis as { __kosmoviaPollarClient?: PollarClient }).__kosmoviaPollarClient ?? null;
}

function myAddress(): string {
  const address = pollarClient()?.getWallet()?.address;
  if (!address) throw new ApiError('Entra con tu wallet para usar la billetera.');
  return address;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toTx(p: PaymentWire, me: string): WalletTransaction {
  const sent = p.from_wallet === me;
  const other = sent ? p.to_profile : p.from_profile;
  return {
    id: p.id,
    type: sent ? 'sent' : 'received',
    counterparty: other ? `@${other.username}` : shortAddress(sent ? p.to_wallet : p.from_wallet),
    amount: Number(p.amount),
    asset: p.asset,
    timestamp: new Date(p.paid_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    hash: p.tx_hash,
    paidAt: p.paid_at,
  };
}

/**
 * Pagos reales con Pollar, con la protección de Pollar Pass que ya usa core:
 * memo único y vida de 5 minutos, recordado antes de enviar; un error sin
 * hash es "desconocido" y se busca por memo, nunca se reenvía.
 */
export class ApiWalletService implements IWalletService {
  async getPublicKey(): Promise<string> {
    return myAddress();
  }

  async getBalances(_publicKey: string): Promise<WalletBalances> {
    const b = await fetchBalances(myAddress());
    if (!b.exists) return { usdc: 0, xlm: 0 };
    return { usdc: Number(b.usdc ?? '0'), xlm: Number(b.xlm) };
  }

  async getTransactions(_publicKey: string): Promise<WalletTransaction[]> {
    const me = myAddress();
    const { payments } = await call<{ payments: PaymentWire[] }>('/api/payments');
    return payments.map((p) => toTx(p, me));
  }

  async sendPayment(input: SendPaymentInput): Promise<WalletTransaction> {
    const client = pollarClient();
    const me = myAddress();
    if (!client) throw new ApiError('Pollar no está listo.');

    // A quién: @usuario (con o sin @, igual que la vista previa) o dirección G….
    // Los cobros B2B a un #canal siguen en modo demo.
    const raw = input.to.trim();
    const handle = raw.replace(/^@/, '').toLowerCase();
    let destination: string;
    if (ADDRESS_RE.test(raw.toUpperCase())) destination = raw.toUpperCase();
    else if (HANDLE_RE.test(handle)) {
      const { profile } = await call<{ profile: ProfileRow }>(`/api/profiles/${encodeURIComponent(handle)}`);
      destination = profile.wallet;
    } else throw new ApiError('Por ahora solo se puede pagar a un @usuario o a una dirección G….');
    if (destination === me) throw new ApiError('No puedes enviarte a ti mismo.');

    const checked = checkAmount(String(input.amount), input.asset);
    if (!checked.ok) throw new ApiError(checked.error);

    const memo = newPaymentRef();
    const startedAt = new Date().toISOString();
    rememberPayment(me, { memo, startedAt, toWallet: destination, toLabel: raw, amount: checked.amount, asset: input.asset, note: '' });
    let outcome: Awaited<ReturnType<PollarClient['sendPayment']>> | undefined;
    client.resetTransactionState();
    try {
      outcome = await client.sendPayment({
        destination,
        amount: checked.amount,
        asset: pollarAsset(input.asset),
        options: paymentOptions(memo),
      });
    } catch (err) {
      // Desconocido: se busca, no se reenvía.
      outcome = { status: 'error', details: err instanceof Error ? err.message : undefined };
    }
    if (classifyWithPhase(outcome, client.getTransactionState()) === 'rejected') {
      forgetPayment(me);
      const reason = rejectionReason(outcome);
      const why = outcome?.status === 'error' ? outcome.details ?? outcome.message ?? '' : '';
      throw new ApiError(reason ? rejectionText(reason, outcome) : `No se pudo enviar y no se movió dinero.${why ? ` Pollar dijo: ${why.slice(0, 160)}` : ''}`);
    }
    if (outcome?.status === 'error' && !outcome.hash) {
      console.warn('[pagos] Pollar no devolvió hash:', [outcome.code, outcome.details ?? outcome.message].filter(Boolean).join(' · '));
    }

    // Verificar en Horizon y guardar (por hash, o por memo si no volvió hash).
    const hash = outcome?.hash;
    const deadline = attemptDeadlineMs(Date.parse(startedAt));
    for (let delay = 2_000; Date.now() < deadline + 60_000; delay = Math.min(delay * 1.5, 10_000)) {
      const useHash = hash && Date.now() < deadline ? hash : undefined;
      const res = await apiRequest<{ payment?: PaymentWire }>('/api/payments', {
        method: 'POST',
        body: { hash: useHash, memo, startedAt, note: '' },
      });
      if (res.ok && res.data.payment) {
        forgetPayment(me);
        return toTx(res.data.payment, me);
      }
      if (!res.ok && res.status === 404) {
        forgetPayment(me);
        throw new ApiError('Ese pago no llegó a la red. No se movió dinero.');
      }
      if (!res.ok && res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429) {
        forgetPayment(me);
        throw new ApiError(res.error);
      }
      await wait(delay);
    }
    throw new ApiError('La red todavía no confirma el pago. Revisa tu historial en un momento; no lo envíes de nuevo.');
  }
}
