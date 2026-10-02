import type { Channel, Community, Message, User } from "../types/index.ts";

/** Row shapes as PostgREST returns them (snake_case). */
export interface ProfileRow {
  id: string;
  wallet: string;
  username: string;
  display_name: string | null;
  avatar_seed: string | null;
  avatar_style: string | null;
  bio: string | null;
  trust_level: number | null;
  x_handle: string | null;
  x_verified_at?: string | null;
  created_at?: string;
}

/** Only what a chat bubble needs from an author: no wallet, bio, trust level or X handle. */
export const AUTHOR_COLUMNS = "id,username,display_name,avatar_seed,avatar_style";

export interface AuthorRow {
  id: string;
  username: string;
  display_name: string | null;
  avatar_seed: string | null;
  avatar_style: string | null;
}

export interface CommunityRow {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  description: string | null;
  owner_id: string;
  created_at?: string;
}

export interface ChannelRow {
  id: string;
  community_id: string;
  name: string;
  topic: string | null;
  type: string;
}

export interface MessageRow {
  id: string;
  channel_id: string;
  author_id: string;
  content: string;
  created_at: string;
}

export type MemberRole = "owner" | "admin" | "member";

export interface MemberRow {
  community_id: string;
  profile_id: string;
  role: string;
  joined_at?: string;
}

/** The UI shows "@name"; the database stores "name". */
export function toHandle(username: string): string {
  return username.startsWith("@") ? username : `@${username}`;
}

export function fromHandle(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export function mapProfile(row: ProfileRow): User {
  const trust = row.trust_level === 1 || row.trust_level === 2 ? row.trust_level : 0;
  return {
    id: row.id,
    username: toHandle(row.username),
    displayName: row.display_name || row.username,
    bio: row.bio ?? undefined,
    wallet: row.wallet,
    avatarSeed: row.avatar_seed ?? undefined,
    avatarStyle: row.avatar_style ?? undefined,
    trustLevel: trust,
    xHandle: row.x_handle ?? undefined,
  };
}

/** A message author from the slim AUTHOR_COLUMNS select (`wallet` stays empty: it is not fetched). */
export function mapAuthor(row: AuthorRow): User {
  return {
    id: row.id,
    username: toHandle(row.username),
    displayName: row.display_name || row.username,
    wallet: "",
    avatarSeed: row.avatar_seed ?? undefined,
    avatarStyle: row.avatar_style ?? undefined,
  };
}

export function mapChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    communityId: row.community_id,
    name: row.name,
    topic: row.topic ?? undefined,
    type: row.type === "announcement" ? "announcement" : "text",
  };
}

export function mapCommunity(row: CommunityRow, channels: Channel[] = [], members: User[] = []): Community {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    icon: row.icon ?? "",
    description: row.description ?? "",
    channels,
    members,
  };
}

/** `author` is the already-mapped profile (a join, or a cached lookup for realtime inserts). */
export function mapMessage(row: MessageRow, author: User): Message {
  return {
    id: row.id,
    channelId: row.channel_id,
    author,
    content: row.content,
    createdAt: row.created_at,
  };
}

export function asRole(value: string | null | undefined): MemberRole | null {
  return value === "owner" || value === "admin" || value === "member" ? value : null;
}

/** Adds `incoming` to `list` without duplicates (by id), ordered by createdAt then id. */
export function mergeMessages(list: Message[], incoming: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const m of list) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1,
  );
}

/** Messages kept in memory per channel: the newest ones. */
export const MAX_WINDOW = 200;
/** Page size of the first load and of every "Cargar anteriores". */
export const PAGE_SIZE = 50;
/** Hard ceiling of messages in memory, however many pages the user loads. */
export const MAX_LOADED_HISTORY = 1_000;

export const MESSAGE_COLUMNS = "id,channel_id,author_id,content,created_at";

/** Keeps the newest `max` messages of a list sorted oldest first (what mergeMessages returns). */
export function capMessages(list: Message[], max: number = MAX_WINDOW): Message[] {
  return list.length > max ? list.slice(list.length - max) : list;
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ][0-9:.]+(?:Z|[+-]\d{2}(?::?\d{2})?)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PostgREST `or()` expression for "strictly older than this message" with the
 * same (created_at, id) order the list uses, so rows sharing a timestamp are
 * neither skipped nor repeated. Null when the cursor does not look like a
 * timestamp and a UUID (it only ever interpolates values that passed those checks).
 */
export function olderThanFilter(cursor: { createdAt: string; id: string }): string | null {
  if (!ISO_TIMESTAMP.test(cursor.createdAt) || !UUID.test(cursor.id)) return null;
  const at = `"${cursor.createdAt}"`;
  return `created_at.lt.${at},and(created_at.eq.${at},id.lt.${cursor.id})`;
}

const QUOTA_MESSAGES: Record<string, string> = {
  messages_per_minute: "Vas muy rápido: espera un momento antes de enviar más mensajes.",
  messages_per_hour: "Llegaste al máximo de mensajes por hora. Intenta de nuevo más tarde.",
  communities_per_day: "Ya creaste 3 comunidades en las últimas 24 horas. Intenta de nuevo más tarde.",
  communities_total: "Llegaste al máximo de 10 comunidades por perfil.",
  channels_per_community: "Esta comunidad ya tiene el máximo de 50 canales.",
};

/** Spanish message for a quota trigger of 0002_hardening.sql (`quota_exceeded:<kind>`), else null. */
export function quotaMessage(error: { message?: string } | null | undefined): string | null {
  const found = /quota_exceeded:([a-z_]+)/.exec(error?.message ?? "");
  if (!found) return null;
  return QUOTA_MESSAGES[found[1]] ?? "Llegaste a un límite de uso. Intenta de nuevo más tarde.";
}

/** Postgres unique violation, as PostgREST reports it. */
export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}
