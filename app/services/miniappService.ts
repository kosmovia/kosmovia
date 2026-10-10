/**
 * Conexiones con mini-apps: qué apps tiene autorizadas la persona (y con qué
 * permisos). Contrato compartido entre la UI (el host de mini-apps y Seguridad)
 * y el backend (/api/miniapps/connections).
 *
 * Conectar pide el PIN de pagos (el mismo, con el mismo bloqueo por intentos) y
 * lanza `SecurityError` si falla (`wrong_pin`, `locked`, `no_pin`…). Los permisos
 * los pone el servidor según su catálogo, no la UI. Desconectar no pide PIN.
 *
 * Una conexión es el consentimiento que consulta el host; no mueve dinero: cada
 * pago que pida la app sigue necesitando su confirmación con PIN. Cambiar el PIN
 * NO desconecta las apps.
 */
import type { MiniAppPermission } from '../lib/miniapp-sdk/protocol';

export interface MiniAppConnection {
  appId: string;
  permissions: MiniAppPermission[];
  /** ISO: cuándo se autorizó (o se renovó). */
  connectedAt: string;
}

export interface IMiniAppService {
  /** Las apps conectadas ahora. */
  listConnections(): Promise<MiniAppConnection[]>;
  /** Verifica el PIN y conecta `appId`. Lanza `SecurityError` si el PIN no pasa. */
  connect(appId: string, pin: string): Promise<MiniAppConnection>;
  /** Revoca la conexión (si no estaba conectada, no pasa nada). */
  disconnect(appId: string): Promise<void>;
}
