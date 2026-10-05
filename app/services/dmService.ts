import { DmThread, Message, User } from '../types';
import { storage } from './storage';

export interface IDmService {
  /** Conversaciones del usuario, la más reciente primero. */
  getThreads(): Promise<DmThread[]>;
  /** Abre (o crea) la conversación con @usuario. Falla con `no_shared_community` si no comparten comunidad. */
  openThread(username: string): Promise<DmThread>;
  getMessages(threadId: string): Promise<Message[]>;
  sendMessage(threadId: string, content: string, author: User): Promise<Message>;
  editMessage(threadId: string, messageId: string, content: string): Promise<Message>;
  deleteMessage(threadId: string, messageId: string): Promise<void>;
  /** Polling: lo nuevo por `callback`, la última página por `onSync`. */
  subscribeToMessages(
    threadId: string,
    callback: (msg: Message) => void,
    onSync?: (latestPage: Message[], isFullThread: boolean) => void,
  ): () => void;
}

const THREADS_KEY = 'kosmovia_dm_threads';
const MESSAGES_KEY = 'kosmovia_dm_messages';

/** Demo: conversaciones guardadas en este navegador, sin otra persona al otro lado. */
export class MockDmService implements IDmService {
  async getThreads(): Promise<DmThread[]> {
    const list = storage.get<DmThread[]>(THREADS_KEY, []);
    return list.slice().sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
  }

  async openThread(username: string): Promise<DmThread> {
    const list = storage.get<DmThread[]>(THREADS_KEY, []);
    const found = list.find((t) => t.other.username === username);
    if (found) return found;
    const other: User = { id: `u-${username}`, username, displayName: username.replace(/^@/, '') };
    const thread: DmThread = { id: `dm-${Date.now()}`, other, lastMessage: null, unread: 0 };
    storage.set(THREADS_KEY, [...list, thread]);
    return thread;
  }

  async getMessages(threadId: string): Promise<Message[]> {
    return storage.get<Record<string, Message[]>>(MESSAGES_KEY, {})[threadId] ?? [];
  }

  async sendMessage(threadId: string, content: string, author: User): Promise<Message> {
    const all = storage.get<Record<string, Message[]>>(MESSAGES_KEY, {});
    const now = new Date();
    const message: Message = {
      id: `dmm-${now.getTime()}`,
      channelId: threadId,
      author,
      content,
      createdAt: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    all[threadId] = [...(all[threadId] ?? []), message];
    storage.set(MESSAGES_KEY, all);
    const threads = storage.get<DmThread[]>(THREADS_KEY, []);
    storage.set(
      THREADS_KEY,
      threads.map((t) =>
        t.id === threadId
          ? { ...t, lastMessage: { content, createdAt: message.createdAt, authorId: author.id }, lastMessageAt: now.toISOString() }
          : t,
      ),
    );
    return message;
  }

  async editMessage(threadId: string, messageId: string, content: string): Promise<Message> {
    const all = storage.get<Record<string, Message[]>>(MESSAGES_KEY, {});
    const found = (all[threadId] ?? []).find((m) => m.id === messageId);
    if (!found) throw new Error('Mensaje no encontrado.');
    const updated: Message = { ...found, content, editedAt: new Date().toISOString() };
    all[threadId] = all[threadId].map((m) => (m.id === messageId ? updated : m));
    storage.set(MESSAGES_KEY, all);
    return updated;
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const all = storage.get<Record<string, Message[]>>(MESSAGES_KEY, {});
    all[threadId] = (all[threadId] ?? []).filter((m) => m.id !== messageId);
    storage.set(MESSAGES_KEY, all);
  }

  subscribeToMessages(): () => void {
    return () => {};
  }
}
