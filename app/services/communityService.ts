import { Category, Channel, Community, User } from '../types';
import { INITIAL_COMMUNITIES } from './mockData';
import { storage } from './storage';

export interface CreateCommunityInput {
  name: string;
  slug: string;
  icon: string;
  description: string;
  /** Foto ya recortada a 256 px (data URL), opcional. */
  image?: string;
}

export interface CreateChannelInput {
  name: string;
  topic?: string;
  type?: 'text' | 'announcement';
  emoji?: string | null;
  categoryId?: string | null;
  visibility?: 'public' | 'private';
}

/** Cambios parciales de un canal (dueño o admin). */
export interface UpdateChannelInput {
  topic?: string;
  emoji?: string | null;
  categoryId?: string | null;
  visibility?: 'public' | 'private';
  position?: number;
}

export interface ICommunityService {
  getCommunities(): Promise<Community[]>;
  getCommunityById(id: string): Promise<Community | null>;
  createCommunity(input: CreateCommunityInput): Promise<Community>;
  createChannel(communityId: string, input: CreateChannelInput): Promise<Channel>;
  /** Dueño o admin: cambia la descripción (tema) de un canal; "" la quita. */
  updateChannelTopic(communityId: string, channelId: string, topic: string): Promise<Channel>;
  /** Dueño o admin: cambia parte de un canal (emoji, categoría, visibilidad, orden, descripción). */
  updateChannel(communityId: string, channelId: string, patch: UpdateChannelInput): Promise<Channel>;
  /** Dueño o admin: categorías. Al borrar una, sus canales quedan sin categoría. */
  createCategory(communityId: string, name: string): Promise<Category>;
  updateCategory(communityId: string, categoryId: string, patch: { name?: string; position?: number }): Promise<Category>;
  deleteCategory(communityId: string, categoryId: string): Promise<void>;
  /** Solo el dueño: cambia (o quita, con null) la foto. */
  updateImage(communityId: string, image: string | null): Promise<Community>;
  /** Dueño o admin: cambia la descripción de la comunidad; "" la quita. */
  updateDescription(communityId: string, description: string): Promise<Community>;
  /** Unirse por el link de invitación (/plataforma?c=<slug>). */
  joinBySlug?(slug: string): Promise<void>;
  /** Dueño (cualquier rol salvo dueño) o admin (moderador/miembro). Devuelve el miembro actualizado. */
  setMemberRole?(communityId: string, profileId: string, role: 'admin' | 'moderator' | 'member'): Promise<User>;
  /** Dueño o admin; #general no se borra. */
  deleteChannel?(communityId: string, channelId: string): Promise<void>;
  /** Solo el dueño. Borra canales y mensajes. */
  deleteCommunity?(communityId: string): Promise<void>;
}

const STORAGE_KEY = 'kosmovia_communities';

export class MockCommunityService implements ICommunityService {
  async getCommunities(): Promise<Community[]> {
    // Simular latencia de red async
    await new Promise((r) => setTimeout(r, 60));
    return storage.get<Community[]>(STORAGE_KEY, INITIAL_COMMUNITIES);
  }

  async getCommunityById(id: string): Promise<Community | null> {
    const list = await this.getCommunities();
    return list.find((c) => c.id === id) || null;
  }

  async createCommunity(input: CreateCommunityInput): Promise<Community> {
    const list = await this.getCommunities();
    const newCommunity: Community = {
      id: `comm-${Date.now()}`,
      name: input.name,
      slug: input.slug,
      icon: input.icon || '🚀',
      image: input.image,
      description: input.description,
      channels: [
        {
          id: `chan-${Date.now()}`,
          communityId: `comm-${Date.now()}`,
          name: 'general',
          topic: `Bienvenido a ${input.name}`,
          type: 'text',
        },
      ],
      members: [],
    };

    const updated = [...list, newCommunity];
    storage.set(STORAGE_KEY, updated);
    return newCommunity;
  }

  async createChannel(communityId: string, input: CreateChannelInput): Promise<Channel> {
    const list = await this.getCommunities();
    const newChannel: Channel = {
      id: `chan-${Date.now()}`,
      communityId,
      name: input.name,
      topic: input.topic || 'Canal de discusión',
      type: input.type || 'text',
      emoji: input.emoji ?? null,
      categoryId: input.categoryId ?? null,
      visibility: input.visibility ?? 'public',
      position: Date.now(),
    };

    const updated = list.map((c) =>
      c.id === communityId ? { ...c, channels: [...c.channels, newChannel] } : c
    );

    storage.set(STORAGE_KEY, updated);
    return newChannel;
  }

  async updateChannelTopic(communityId: string, channelId: string, topic: string): Promise<Channel> {
    const list = await this.getCommunities();
    let found: Channel | undefined;
    const updated = list.map((c) =>
      c.id === communityId
        ? {
            ...c,
            channels: c.channels.map((ch) => {
              if (ch.id !== channelId) return ch;
              found = { ...ch, topic: topic.trim() || undefined };
              return found;
            }),
          }
        : c
    );
    if (!found) throw new Error('Canal no encontrado.');
    storage.set(STORAGE_KEY, updated);
    return found;
  }

  private async mutate(communityId: string, fn: (c: Community) => Community): Promise<void> {
    const list = await this.getCommunities();
    if (!list.some((c) => c.id === communityId)) throw new Error('Comunidad no encontrada.');
    storage.set(STORAGE_KEY, list.map((c) => (c.id === communityId ? fn(c) : c)));
  }

  async updateChannel(communityId: string, channelId: string, patch: UpdateChannelInput): Promise<Channel> {
    let result: Channel | undefined;
    await this.mutate(communityId, (c) => ({
      ...c,
      channels: c.channels.map((ch) => {
        if (ch.id !== channelId) return ch;
        const { topic, ...rest } = patch;
        result = { ...ch, ...rest, ...(topic !== undefined ? { topic: topic.trim() || undefined } : {}) };
        return result;
      }),
    }));
    if (!result) throw new Error('Canal no encontrado.');
    return result;
  }

  async createCategory(communityId: string, name: string): Promise<Category> {
    const category: Category = { id: `cat-${Date.now()}`, name: name.trim(), position: Date.now() };
    await this.mutate(communityId, (c) => ({ ...c, categories: [...(c.categories ?? []), category] }));
    return category;
  }

  async updateCategory(communityId: string, categoryId: string, patch: { name?: string; position?: number }): Promise<Category> {
    let result: Category | undefined;
    await this.mutate(communityId, (c) => ({
      ...c,
      categories: (c.categories ?? []).map((k) => {
        if (k.id !== categoryId) return k;
        result = { ...k, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}), ...(patch.position !== undefined ? { position: patch.position } : {}) };
        return result;
      }),
    }));
    if (!result) throw new Error('Categoría no encontrada.');
    return result;
  }

  async deleteCategory(communityId: string, categoryId: string): Promise<void> {
    await this.mutate(communityId, (c) => ({
      ...c,
      categories: (c.categories ?? []).filter((k) => k.id !== categoryId),
      channels: c.channels.map((ch) => (ch.categoryId === categoryId ? { ...ch, categoryId: null } : ch)),
    }));
  }

  async updateImage(communityId: string, image: string | null): Promise<Community> {
    const list = await this.getCommunities();
    const updated = list.map((c) => (c.id === communityId ? { ...c, image: image ?? undefined } : c));
    storage.set(STORAGE_KEY, updated);
    const found = updated.find((c) => c.id === communityId);
    if (!found) throw new Error('Comunidad no encontrada.');
    return found;
  }

  async updateDescription(communityId: string, description: string): Promise<Community> {
    const clean = description.trim();
    if (clean.length > 280) throw new Error('La descripción debe tener 280 caracteres como máximo.');
    const list = await this.getCommunities();
    const updated = list.map((c) => (c.id === communityId ? { ...c, description: clean } : c));
    storage.set(STORAGE_KEY, updated);
    const found = updated.find((c) => c.id === communityId);
    if (!found) throw new Error('Comunidad no encontrada.');
    return found;
  }
}
