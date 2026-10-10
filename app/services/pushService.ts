import { storage } from './storage';
import { DEFAULT_PREFS, type NotificationPrefs } from '../lib/core/push-rules.ts';

export type { NotificationPrefs } from '../lib/core/push-rules.ts';

/**
 * Notificaciones push: lo que se habla con el servidor. La parte del navegador
 * (permiso, service worker, pushManager) vive en lib/core/push-client.ts.
 */
export interface PushConfig {
  /** false = el servidor no tiene las claves VAPID (o el modo es demo): el push está apagado. */
  configured: boolean;
  /** Clave pública VAPID para `pushManager.subscribe`. */
  publicKey: string | null;
}

export interface IPushService {
  getConfig(): Promise<PushConfig>;
  getPrefs(): Promise<NotificationPrefs>;
  /** Cambia solo las preferencias que vienen; devuelve las resultantes. */
  setPrefs(patch: Partial<NotificationPrefs>): Promise<NotificationPrefs>;
  /** Guarda (o renueva) la suscripción de este dispositivo: `PushSubscription.toJSON()`. */
  saveSubscription(subscription: PushSubscriptionJSON): Promise<void>;
  removeSubscription(endpoint: string): Promise<void>;
}

const PREFS_KEY = 'kosmovia-push-prefs';

/** Modo demo: no hay servidor que mande avisos; solo se recuerdan las preferencias. */
export class MockPushService implements IPushService {
  async getConfig(): Promise<PushConfig> {
    return { configured: false, publicKey: null };
  }

  async getPrefs(): Promise<NotificationPrefs> {
    return { ...DEFAULT_PREFS, ...storage.get<Partial<NotificationPrefs>>(PREFS_KEY, {}) };
  }

  async setPrefs(patch: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
    const next = { ...(await this.getPrefs()), ...patch };
    storage.set(PREFS_KEY, next);
    return next;
  }

  async saveSubscription(): Promise<void> {}

  async removeSubscription(): Promise<void> {}
}
