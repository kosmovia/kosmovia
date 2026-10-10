import type { Community, User } from '../../types';
import { serverPermissions } from '../../lib/core/miniapps.ts';
import type { usePaymentApproval } from '../PaymentGuard';

/** Qué puede pedir una mini-app. La persona lo aprueba (con su PIN) en la hoja de conexión de Kosmovia. */
export type AppPermission = 'perfil' | 'pagos' | 'mensajes';

/** oficial = de Kosmovia · aprobada = de un tercero ya revisada · en_revision / proximamente = no se abren. */
export type AppStatus = 'oficial' | 'aprobada' | 'en_revision' | 'proximamente';

/** Lo que el panel Aplicaciones recibe de Kosmovia para abrir una mini-app en el host (MiniAppHost). */
export interface AppProps {
  community: Community;
  currentUser: User;
  onClose: () => void;
  requestApproval: ReturnType<typeof usePaymentApproval>;
  notify: (kind: 'info' | 'ok' | 'error', text: string) => void;
  /** Abrir la app directo en algo (p. ej. `{ vaquitaId }` desde una tarjeta del chat). Llega a la app en `ready().params`. */
  initialParams?: Record<string, string>;
  /** Canal activo (null en mensajes directos): es donde publica `share`. */
  activeChannel?: { id: string; name: string } | null;
  /** Tema visual de Kosmovia, para que la app pueda adaptarse. */
  theme?: 'kosmovia' | 'negro';
  /** Publica un mensaje en el canal activo. Devuelve el id del mensaje, o null si no se pudo. */
  shareToChannel?: (text: string) => Promise<string | null>;
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
  /** Debe coincidir con el catálogo del servidor (lib/core/miniapps.ts): ahí se guardan al conectar. */
  permissions: AppPermission[];
  /** Ruta (`/miniapps/vaquita`) o URL de la app. Solo las que la tienen (y están oficial/aprobada) se abren, en MiniAppHost. */
  url?: string;
  /** Color de acento de la pantalla de carga mientras la app arranca. */
  theme?: string;
}

export const PERMISSION_LABELS: Record<AppPermission, string> = {
  perfil: 'Tu perfil',
  pagos: 'Pagos',
  mensajes: 'Mensajes',
};

export function isOpenable(app: MiniApp): boolean {
  return Boolean(app.url) && (app.status === 'oficial' || app.status === 'aprobada');
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
    // Los permisos salen del catálogo del servidor, para que no se separen.
    permissions: serverPermissions('vaquita') ?? [],
    url: '/miniapps/vaquita',
    theme: '#B84A26',
  },
  {
    id: 'retos',
    name: 'Retos',
    tagline: 'Juega con tus amigos: tres en raya y piedra, papel o tijera',
    icon: '🎮',
    developer: 'Kosmovia',
    status: 'oficial',
    permissions: serverPermissions('retos') ?? [],
    url: '/miniapps/retos',
    theme: '#5B2BD9',
  },
  {
    id: 'aprende',
    name: 'Aprende Stellar',
    tagline: 'Lecciones de 2 minutos, misiones e insignias',
    icon: '🎓',
    developer: 'Kosmovia',
    status: 'oficial',
    permissions: serverPermissions('aprende') ?? [],
    url: '/miniapps/aprende',
    theme: '#1B2A55',
  },
  { id: 'pasanaku', name: 'Pasanaku', tagline: 'Ronda de ahorro por turnos', icon: '🔄', developer: 'Kosmovia', status: 'proximamente', permissions: ['perfil', 'pagos'] },
  { id: 'dividir', name: 'Dividir la cuenta', tagline: 'Repartan un gasto entre todos', icon: '🧾', developer: 'Kosmovia', status: 'proximamente', permissions: ['perfil', 'pagos'] },
  { id: 'propinas', name: 'Propinas para creadores', tagline: 'Apoya a quien te gusta', icon: '✨', developer: 'Kosmovia', status: 'proximamente', permissions: ['perfil', 'pagos'] },
  { id: 'membresias', name: 'Membresías', tagline: 'Acceso de pago a tu comunidad', icon: '🎟️', developer: 'Kosmovia', status: 'proximamente', permissions: ['perfil', 'pagos'] },
  { id: 'talento', name: 'Talento', tagline: 'Freelancers e influencers con reputación, conectados con empresas', icon: '🧑‍💻', developer: 'Kosmovia', status: 'proximamente', permissions: ['perfil', 'mensajes'] },
];
