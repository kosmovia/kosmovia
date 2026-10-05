// Contrato compartido con app/types/index.ts (Victor). Mantener los mismos nombres de campos.

export interface User {
  id: string;
  username: string; // e.g. "@victor"
  displayName: string;
  avatar?: string;
  role?: 'admin' | 'builder' | 'member';
  isOnline?: boolean;
  bio?: string;
  statusText?: string;
  // Campos nuevos de core
  wallet: string; // direccion Stellar (G...)
  avatarSeed?: string;
  avatarStyle?: string;
  trustLevel?: 0 | 1 | 2; // 0 wallet · 1 social · 2 empresa
  xHandle?: string;
  usernameChangedAt?: string; // ISO; se puede cambiar 1 vez cada 24 h
  avatarChangedAt?: string; // ISO; se puede cambiar 1 vez cada 3 días
}

export interface Channel {
  id: string;
  communityId: string;
  name: string; // e.g. "general"
  topic?: string;
  type: 'text' | 'announcement';
}

export interface Community {
  id: string;
  name: string;
  slug: string;
  icon: string;
  description: string;
  channels: Channel[];
  members: User[];
}

export interface Message {
  id: string;
  channelId: string;
  author: User;
  content: string;
  createdAt: string;
}

export interface WalletTransaction {
  id: string;
  type: 'sent' | 'received';
  counterparty: string; // e.g. "@roberto"
  amount: number;
  asset: 'USDC' | 'XLM';
  timestamp: string;
  hash: string;
}
