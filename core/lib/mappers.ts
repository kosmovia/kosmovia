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

/** Postgres unique violation, as PostgREST reports it. */
export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}
