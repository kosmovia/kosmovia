/**
 * Adapter "api" de las notificaciones push: habla con /api/push/*.
 */
import { apiRequest } from '../../lib/core/api-client.ts';
import type { IPushService, NotificationPrefs, PushConfig } from '../pushService';

export class ApiPushService implements IPushService {
  async getConfig(): Promise<PushConfig> {
    const res = await apiRequest<{ configured: boolean; publicKey: string | null }>('/api/push/public-key');
    if (!res.ok) return { configured: false, publicKey: null };
    return { configured: Boolean(res.data.configured && res.data.publicKey), publicKey: res.data.publicKey ?? null };
  }

  async getPrefs(): Promise<NotificationPrefs> {
    const res = await apiRequest<{ prefs: NotificationPrefs }>('/api/push/prefs');
    if (!res.ok) throw new Error(res.error);
    return res.data.prefs;
  }

  async setPrefs(patch: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
    const res = await apiRequest<{ prefs: NotificationPrefs }>('/api/push/prefs', { method: 'PUT', body: patch });
    if (!res.ok) throw new Error(res.error);
    return res.data.prefs;
  }

  async saveSubscription(subscription: PushSubscriptionJSON): Promise<void> {
    const res = await apiRequest<{ ok: true }>('/api/push/subscriptions', { method: 'POST', body: subscription });
    if (!res.ok) throw new Error(res.error);
  }

  async removeSubscription(endpoint: string): Promise<void> {
    const res = await apiRequest<{ ok: true }>('/api/push/subscriptions', { method: 'DELETE', body: { endpoint } });
    if (!res.ok) throw new Error(res.error);
  }
}
