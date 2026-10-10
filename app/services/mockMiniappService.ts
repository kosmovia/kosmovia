/**
 * Modo demo de las conexiones con mini-apps: el mismo contrato que el backend, con
 * el estado en localStorage. El PIN se verifica con el mismo bloqueo de la demo de
 * seguridad y los permisos salen del mismo catálogo que usa el servidor.
 */
import { serverPermissions } from '../lib/core/miniapps.ts';
import type { IMiniAppService, MiniAppConnection } from './miniappService';
import { MockSecurityService } from './mockSecurityService';
import { SecurityError } from './securityService';
import { storage } from './storage';

const STORAGE_KEY = 'kosmovia_miniapp_connections_mock';

export class MockMiniAppService implements IMiniAppService {
  private security = new MockSecurityService();

  async listConnections(): Promise<MiniAppConnection[]> {
    return storage.get<MiniAppConnection[]>(STORAGE_KEY, []);
  }

  async connect(appId: string, pin: string): Promise<MiniAppConnection> {
    const permissions = serverPermissions(appId);
    if (!permissions) throw new SecurityError('Esa app no existe.', 'unknown');
    await this.security.verifyPin(pin);
    const connection: MiniAppConnection = { appId, permissions, connectedAt: new Date().toISOString() };
    const rest = (await this.listConnections()).filter((c) => c.appId !== appId);
    storage.set(STORAGE_KEY, [connection, ...rest]);
    return connection;
  }

  async disconnect(appId: string): Promise<void> {
    storage.set(
      STORAGE_KEY,
      (await this.listConnections()).filter((c) => c.appId !== appId),
    );
  }
}
