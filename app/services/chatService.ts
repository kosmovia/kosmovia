import { Message, User } from '../types';
import { INITIAL_MESSAGES } from './mockData';
import { storage } from './storage';

export interface IChatService {
  getMessages(channelId: string): Promise<Message[]>;
  sendMessage(channelId: string, content: string, author: User): Promise<Message>;
  /** Edita un mensaje propio. */
  editMessage(channelId: string, messageId: string, content: string): Promise<Message>;
  /** Borra un mensaje (el autor, o dueño/admin/moderador). */
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  /**
   * `callback`: cada mensaje nuevo. `onSync` (opcional): la última página completa de
   * mensajes, para reflejar ediciones y borrados hechos por otras personas.
   */
  subscribeToMessages(
    channelId: string,
    callback: (msg: Message) => void,
    onSync?: (latestPage: Message[], isFullChannel: boolean) => void,
  ): () => void;
  /**
   * Avisa que `profileId` está escribiendo. Opcional: solo existe donde hay
   * tiempo real (modo "api" con Supabase); en el modo demo no se implementa.
   * Se puede llamar por cada tecla, el adaptador limita la frecuencia.
   */
  notifyTyping?(channelId: string, profileId: string): void;
  /**
   * Ids de perfil que están escribiendo en el canal, con su propia expiración.
   * Devuelve la función de baja. Opcional, igual que `notifyTyping`.
   */
  subscribeToTyping?(channelId: string, onChange: (profileIds: string[]) => void): () => void;
}

const STORAGE_KEY = 'kosmovia_messages_by_channel';

type Listener = (msg: Message) => void;

export class MockChatService implements IChatService {
  private listeners: Map<string, Set<Listener>> = new Map();

  async getMessages(channelId: string): Promise<Message[]> {
    await new Promise((r) => setTimeout(r, 40));
    const all = storage.get<Record<string, Message[]>>(STORAGE_KEY, INITIAL_MESSAGES);
    return all[channelId] || [];
  }

  async sendMessage(channelId: string, content: string, author: User): Promise<Message> {
    const all = storage.get<Record<string, Message[]>>(STORAGE_KEY, INITIAL_MESSAGES);
    const newMessage: Message = {
      id: `m-${Date.now()}`,
      channelId,
      author,
      content,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const currentList = all[channelId] || [];
    all[channelId] = [...currentList, newMessage];
    storage.set(STORAGE_KEY, all);

    // Notificar a suscriptores en tiempo real (simulando WebSockets / Supabase Realtime)
    this.broadcast(channelId, newMessage);

    return newMessage;
  }

  async editMessage(channelId: string, messageId: string, content: string): Promise<Message> {
    const all = storage.get<Record<string, Message[]>>(STORAGE_KEY, INITIAL_MESSAGES);
    const list = all[channelId] || [];
    const found = list.find((m) => m.id === messageId);
    if (!found) throw new Error('Mensaje no encontrado.');
    const updated: Message = { ...found, content, editedAt: new Date().toISOString() };
    all[channelId] = list.map((m) => (m.id === messageId ? updated : m));
    storage.set(STORAGE_KEY, all);
    return updated;
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    const all = storage.get<Record<string, Message[]>>(STORAGE_KEY, INITIAL_MESSAGES);
    all[channelId] = (all[channelId] || []).filter((m) => m.id !== messageId);
    storage.set(STORAGE_KEY, all);
  }

  subscribeToMessages(channelId: string, callback: Listener, _onSync?: (latestPage: Message[], isFullChannel: boolean) => void): () => void {
    if (!this.listeners.has(channelId)) {
      this.listeners.set(channelId, new Set());
    }

    this.listeners.get(channelId)!.add(callback);

    // Devolver función para desuscribirse
    return () => {
      const set = this.listeners.get(channelId);
      if (set) {
        set.delete(callback);
      }
    };
  }

  private broadcast(channelId: string, message: Message) {
    const set = this.listeners.get(channelId);
    if (set) {
      set.forEach((cb) => {
        try {
          cb(message);
        } catch (err) {
          console.error('[chatService] Listener error:', err);
        }
      });
    }
  }
}
