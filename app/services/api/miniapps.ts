/**
 * Adapter "api" de las conexiones con mini-apps: habla con /api/miniapps/connections.
 * Los errores del PIN llegan como `SecurityError` (mismos códigos que al pagar).
 */
import { apiRequest } from '../../lib/core/api-client.ts';
import type { MiniAppConnectionWire } from '../../lib/core/miniapps.ts';
import type { IMiniAppService, MiniAppConnection } from '../miniappService';
import { toSecurityError } from './security';

function toConnection(wire: MiniAppConnectionWire): MiniAppConnection {
  return { appId: wire.appId, permissions: wire.permissions, connectedAt: wire.createdAt };
}

export class ApiMiniAppService implements IMiniAppService {
  async listConnections(): Promise<MiniAppConnection[]> {
    const res = await apiRequest<{ connections: MiniAppConnectionWire[] }>('/api/miniapps/connections');
    if (!res.ok) throw new Error(res.error);
    return (res.data.connections ?? []).map(toConnection);
  }

  async connect(appId: string, pin: string): Promise<MiniAppConnection> {
    const res = await apiRequest<{ connection: MiniAppConnectionWire }>('/api/miniapps/connections', {
      method: 'POST',
      body: { appId, pin },
    });
    if (!res.ok) throw toSecurityError(res);
    return toConnection(res.data.connection);
  }

  async disconnect(appId: string): Promise<void> {
    const res = await apiRequest<unknown>(`/api/miniapps/connections/${encodeURIComponent(appId)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(res.error);
  }
}
