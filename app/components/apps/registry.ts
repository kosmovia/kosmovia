import type React from 'react';
import type { Community, User } from '../../types';
import type { usePaymentApproval } from '../PaymentGuard';
import { VaquitaApp } from './VaquitaApp';

/** Qué puede pedir una mini-app. Más adelante la persona aprobará cada permiso al abrirla. */
export type AppPermission = 'perfil' | 'pagos' | 'mensajes';

/** oficial = de Kosmovia · aprobada = de un tercero ya revisada · en_revision / proximamente = no se abren. */
export type AppStatus = 'oficial' | 'aprobada' | 'en_revision' | 'proximamente';

/** Lo que Kosmovia le entrega a cada mini-app al abrirla. */
export interface AppProps {
  community: Community;
  currentUser: User;
  onClose: () => void;
  requestApproval: ReturnType<typeof usePaymentApproval>;
  notify: (kind: 'info' | 'ok' | 'error', text: string) => void;
  /** Abrir la app directo en algo (p. ej. una vaquita compartida en el chat). */
  initialParams?: { vaquitaId?: string };
  /** Publica un mensaje en el canal activo. */
  shareToChannel?: (text: string) => void | Promise<void>;
}

/** Una entrada del catálogo. Pensado para que luego terceros publiquen las suyas vía API. */
export interface MiniApp {
  id: string;
  name: string;
  tagline: string;
  /** Emoji. */
  icon: string;
  developer: 'Kosmovia' | string;
  status: AppStatus;
  permissions: AppPermission[];
  /** Solo las que lo tienen (y están en estado oficial/aprobada) se pueden abrir. */
  component?: React.ComponentType<AppProps>;
}

export const PERMISSION_LABELS: Record<AppPermission, string> = {
  perfil: 'Tu perfil',
  pagos: 'Pagos',
  mensajes: 'Mensajes',
};

export function isOpenable(app: MiniApp): boolean {
  return Boolean(app.component) && (app.status === 'oficial' || app.status === 'aprobada');
}

/** Catálogo de mini-apps. Hoy es una lista fija; luego saldrá de una API para que terceros publiquen. */
export const MINI_APPS: MiniApp[] = [
  {
    id: 'vaquita',
    name: 'Vaquita',
    tagline: 'Junten dinero para algo en común',
    icon: '🐄',
    developer: 'Kosmovia',
    status: 'oficial',
    permissions: ['perfil', 'pagos'],
    component: VaquitaApp,
  },
  { id: 'pasanaku', name: 'Pasanaku', tagline: 'Ronda de ahorro por turnos', icon: '🔄', developer: 'Kosmovia', status: 'proximamente', permissions: ['perfil', 'pagos'] },
  { id: 'dividir', name: 'Dividir la cuenta', tagline: 'Repartan un gasto entre todos', icon: '🧾', developer: 'Kosmovia', status: 'proximamente', permissions: ['perfil', 'pagos'] },
  { id: 'propinas', name: 'Propinas para creadores', tagline: 'Apoya a quien te gusta', icon: '✨', developer: 'Kosmovia', status: 'proximamente', permissions: ['perfil', 'pagos'] },
  { id: 'membresias', name: 'Membresías', tagline: 'Acceso de pago a tu comunidad', icon: '🎟️', developer: 'Kosmovia', status: 'proximamente', permissions: ['perfil', 'pagos'] },
  { id: 'talento', name: 'Talento', tagline: 'Freelancers e influencers con reputación, conectados con empresas', icon: '🧑‍💻', developer: 'Kosmovia', status: 'proximamente', permissions: ['perfil', 'mensajes'] },
];
