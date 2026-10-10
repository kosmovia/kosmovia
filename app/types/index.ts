export interface User {
  id: string;
  username: string; // e.g. "@victor"
  displayName: string;
  avatar?: string;
  /** owner/admin/moderator/member vienen de core; builder es de los datos de ejemplo. */
  role?: 'owner' | 'admin' | 'moderator' | 'builder' | 'member';
  isOnline?: boolean;
  bio?: string;
  statusText?: string;
  // Campos de core (mismo contrato que lib/core/types.ts)
  wallet?: string; // dirección Stellar (G...)
  trustLevel?: 0 | 1 | 2; // 0 wallet · 1 social (X verificado) · 2 empresa
  xHandle?: string; // cuenta de X verificada
  memberSince?: string; // ISO: cuándo creó su perfil
}

export interface Channel {
  id: string;
  communityId: string;
  name: string; // e.g. "general"
  topic?: string;
  /** 'payments' = #verificacion-pagos: solo comprobantes automáticos, nadie escribe. */
  type: 'text' | 'announcement' | 'payments';
  categoryId?: string | null;
  position?: number;
  visibility?: 'public' | 'private';
  emoji?: string | null;
}

export interface Category {
  id: string;
  name: string;
  position: number;
}

export interface DmThread {
  id: string;
  other: User;
  lastMessage: { content: string; createdAt: string; authorId: string } | null;
  unread: number;
  lastMessageAt?: string;
}

export interface Community {
  id: string;
  name: string;
  slug: string;
  icon: string;
  /** Foto de la comunidad (data URL chica), si tiene. */
  image?: string;
  description: string;
  channels: Channel[];
  categories?: Category[];
  members: User[];
}

export interface Message {
  id: string;
  channelId: string;
  author: User;
  content: string;
  createdAt: string;
  /** ISO de la última edición; sin valor si nunca se editó. */
  editedAt?: string;
}

export interface WalletTransaction {
  id: string;
  type: 'sent' | 'received';
  counterparty: string; // e.g. "@roberto"
  amount: number;
  asset: 'USDC' | 'XLM';
  timestamp: string;
  hash: string;
  paidAt?: string; // ISO, para saber qué es nuevo en las notificaciones
  /** Pago enviado que no pasó por el PIN (lo marca el servidor). */
  unverified?: boolean;
}

export interface SettlementRecord {
  id: string;
  orderId: string;
  concept: string;
  client: string;
  totalUSDC: number;
  feeUSDC: number; // 0.5% comision pasarela
  netUSDC: number;
  status: 'COMPLETED' | 'PENDING';
  settlementTxHash: string;
  createdAt: string;
}

