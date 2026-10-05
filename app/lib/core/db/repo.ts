import type { AuthorRow, ChannelRow, CommunityRow, ProfileRow } from "../mappers.ts";
import {
  canAssignRole,
  canCreateChannel,
  canDeleteChannel,
  canPostInChannel,
  canReadCommunity,
  roleOf,
  type AssignableRole,
  type ChannelType,
  type Decision,
  type Role,
} from "../authz.ts";
import { getPool } from "./pool.ts";
import * as q from "./sql.ts";

/**
 * Data access of the "api" backend: parameterized queries only (the builders
 * are in sql.ts) plus the authorization rules (lib/authz.ts), which mirror the
 * RLS of the Supabase migrations. Every function takes the caller's profile id
 * from the verified session; ids and wallets sent in a request body are never
 * trusted. Database errors are thrown as-is: routes turn them into answers with
 * lib/db/errors.ts. Server-only.
 */

export class DbNotConfiguredError extends Error {
  constructor() {
    super("db_not_configured");
    this.name = "DbNotConfiguredError";
  }
}

async function run<T = Record<string, unknown>>(query: q.Query | null): Promise<T[]> {
  if (!query) return [];
  const pool = getPool();
  if (!pool) throw new DbNotConfiguredError();
  const result = await pool.query(query.text, query.values);
  return result.rows as T[];
}

async function one<T = Record<string, unknown>>(query: q.Query | null): Promise<T | null> {
  const rows = await run<T>(query);
  return rows[0] ?? null;
}

// ----------------------------------------------------------------- profiles

export const getProfileById = (id: string) => one<ProfileRow>(q.profileById(id));
export const getProfileByUsername = (username: string) => one<ProfileRow>(q.profileByUsername(username));
export const getProfileByWallet = (wallet: string) => one<ProfileRow>(q.profileByWallet(wallet));

export async function takenUsernames(names: string[]): Promise<Set<string>> {
  if (names.length === 0) return new Set();
  const rows = await run<{ username: string }>(q.takenUsernames(names));
  return new Set(rows.map((r) => r.username));
}

/** id and wallet come from the session, never from the body. */
export const createProfile = (p: q.NewProfile) => one<ProfileRow>(q.insertProfile(p));

/** Own profile only: `id` is the session's. Null when there is no such profile (or nothing to change). */
export const updateOwnProfile = (id: string, patch: q.ProfilePatch) => one<ProfileRow>(q.updateProfile(id, patch));

export type XPersistOutcome = { persisted: true } | { persisted: false; reason: "no_profile" | "error" | "x_taken" };

/**
 * Saves a verified X account: x_handle, x_verified_at and trust_level = 1 (never 2,
 * and a level-2 profile is left alone). A handle already on another profile
 * throws a unique violation, which the caller maps to `x_taken`.
 */
export async function persistXVerification(opts: {
  profileId: string;
  wallet: string;
  handle: string;
  verifiedAt: string;
}): Promise<XPersistOutcome> {
  const updated = await one(q.persistXVerification(opts.profileId, opts.wallet, opts.handle, opts.verifiedAt));
  if (updated) return { persisted: true };
  const existing = await one<{ trust_level: number }>(q.profileTrustLevel(opts.profileId, opts.wallet));
  return existing ? { persisted: false, reason: "error" } : { persisted: false, reason: "no_profile" };
}

// -------------------------------------------------------------- communities

export const listCommunities = (limit = 100) => run<CommunityRow>(q.listCommunities(Math.min(Math.max(limit, 1), 100)));
export const getCommunityBySlug = (slug: string) => one<CommunityRow>(q.communityBySlug(slug));

export async function listMyCommunityIds(profileId: string): Promise<string[]> {
  const rows = await run<{ community_id: string }>(q.myCommunityIds(profileId));
  return rows.map((r) => r.community_id);
}

/** The caller becomes owner and #general / #anuncios are created by a trigger. */
export const createCommunity = (c: q.NewCommunity) => one<CommunityRow>(q.insertCommunity(c));

/** Cambia la foto; null si quien llama no es el dueño. */
export const setCommunityImage = (slug: string, ownerId: string, image: string | null) =>
  one<CommunityRow>(q.updateCommunityImage(slug, ownerId, image));

/** Borra la comunidad con todo lo suyo; false si quien llama no es el dueño (o no existe). */
export async function deleteCommunity(slug: string, ownerId: string): Promise<boolean> {
  return (await one(q.deleteCommunity(slug, ownerId))) !== null;
}

/** Joins as 'member' (never a higher role). Joining twice is fine. */
export async function joinCommunity(communityId: string, profileId: string): Promise<void> {
  await run(q.joinCommunity(communityId, profileId));
}

export async function getRole(communityId: string, profileId: string): Promise<Role> {
  const row = await one<{ role: string }>(q.memberRole(communityId, profileId));
  return roleOf(row?.role);
}

export type MemberWithProfile = { role: string; joined_at: string; profile: ProfileRow };

export type Guarded<T> = { ok: true; value: T } | { ok: false; denied: Extract<Decision, { allowed: false }> };

const FORBIDDEN: Extract<Decision, { allowed: false }> = { allowed: false, status: 403, code: "forbidden", error: "No permitido." };

/** Members of a community, for its members only. */
export async function listMembers(communityId: string, profileId: string): Promise<Guarded<MemberWithProfile[]>> {
  const decision = canReadCommunity(await getRole(communityId, profileId));
  if (!decision.allowed) return { ok: false, denied: decision };
  return { ok: true, value: await run<MemberWithProfile>(q.listMembers(communityId)) };
}

/**
 * Cambia el rol de `targetId`. Se revisa la regla pura (para responder con el
 * motivo) y otra vez dentro del UPDATE (por si el rol cambia entre las dos).
 */
export async function setMemberRole(
  communityId: string,
  actorId: string,
  targetId: string,
  newRole: AssignableRole,
): Promise<Guarded<MemberWithProfile>> {
  const [actorRole, targetRole] = await Promise.all([getRole(communityId, actorId), getRole(communityId, targetId)]);
  const decision = canAssignRole(actorRole, targetRole, newRole);
  if (!decision.allowed) return { ok: false, denied: decision };
  const row = await one<MemberWithProfile>(q.setMemberRole(communityId, targetId, newRole, actorId));
  return row ? { ok: true, value: row } : { ok: false, denied: FORBIDDEN };
}

// ----------------------------------------------------------------- channels

/** Channels of a community, for its members only. */
export async function listChannels(communityId: string, profileId: string): Promise<Guarded<ChannelRow[]>> {
  const decision = canReadCommunity(await getRole(communityId, profileId));
  if (!decision.allowed) return { ok: false, denied: decision };
  return { ok: true, value: await run<ChannelRow>(q.listChannels(communityId)) };
}

/** Owner and admin only. */
export async function createChannel(
  communityId: string,
  profileId: string,
  input: { name: string; topic: string | null; type: ChannelType },
): Promise<Guarded<ChannelRow>> {
  const decision = canCreateChannel(await getRole(communityId, profileId));
  if (!decision.allowed) return { ok: false, denied: decision };
  const row = await one<ChannelRow>(q.insertChannel({ communityId, ...input }));
  return row ? { ok: true, value: row } : { ok: false, denied: { allowed: false, status: 403, code: "forbidden", error: "No permitido." } };
}

/** Borra un canal y sus mensajes: owner/admin, nunca #general. */
export async function deleteChannel(channelId: string, profileId: string): Promise<Guarded<true> | { ok: false; notFound: true }> {
  const access = await getChannelAccess(channelId, profileId);
  if (!access.found) return { ok: false, notFound: true };
  const decision = canDeleteChannel(access.role, access.name);
  if (!decision.allowed) return { ok: false, denied: decision };
  const row = await one(q.deleteChannel(channelId, profileId));
  return row ? { ok: true, value: true } : { ok: false, denied: FORBIDDEN };
}

// ----------------------------------------------------------------- messages

export type MessageWire = {
  id: string;
  channel_id: string;
  author_id: string;
  content: string;
  created_at: string;
  author: AuthorRow;
};

export type ChannelAccess =
  | { found: false }
  | { found: true; communityId: string; name: string; type: ChannelType; role: Role };

export async function getChannelAccess(channelId: string, profileId: string): Promise<ChannelAccess> {
  const row = await one<{ community_id: string; name: string; type: string; role: string | null }>(q.channelWithRole(channelId, profileId));
  if (!row) return { found: false };
  return {
    found: true,
    communityId: row.community_id,
    name: row.name,
    type: row.type === "announcement" ? "announcement" : "text",
    role: roleOf(row.role),
  };
}

export interface MessagePage {
  before?: string;
  after?: string;
  limit?: number;
}

/**
 * Messages of a channel, oldest first, for its members only. No cursor: the
 * newest page. `before`: the page older than that message. `after`: what came
 * after it (polling; it overlaps a few seconds, the client dedupes by id).
 */
export async function listMessages(
  channelId: string,
  profileId: string,
  page: MessagePage = {},
): Promise<Guarded<MessageWire[]> | { ok: false; notFound: true }> {
  const access = await getChannelAccess(channelId, profileId);
  if (!access.found) return { ok: false, notFound: true };
  const decision = canReadCommunity(access.role);
  if (!decision.allowed) return { ok: false, denied: decision };

  const limit = q.pageSize(page.limit);
  if (page.after) {
    return { ok: true, value: await run<MessageWire>(q.messagesAfter(channelId, page.after, limit)) };
  }
  const rows = await run<MessageWire>(q.messagesNewest(channelId, limit, page.before));
  return { ok: true, value: rows.reverse() };
}

/**
 * Posts a message as `profileId`. Checked twice: the pure rule first (to
 * answer 403 with a reason) and again inside the INSERT itself (so a role
 * change between the two can't be raced). `content` is already validated.
 */
export async function postMessage(
  channelId: string,
  profileId: string,
  content: string,
): Promise<Guarded<MessageWire> | { ok: false; notFound: true }> {
  const access = await getChannelAccess(channelId, profileId);
  if (!access.found) return { ok: false, notFound: true };
  const decision = canPostInChannel(access.role, access.type);
  if (!decision.allowed) return { ok: false, denied: decision };

  const row = await one<MessageWire>(q.insertMessage(channelId, profileId, content));
  if (!row) {
    return { ok: false, denied: { allowed: false, status: 403, code: "forbidden", error: "No puedes escribir en este canal." } };
  }
  return { ok: true, value: row };
}

// ----------------------------------------------------------------- payments

export type PaymentParty = { username: string; display_name: string; avatar_seed: string | null; avatar_style: string | null };

export type PaymentWire = {
  id: string;
  tx_hash: string;
  from_wallet: string;
  to_wallet: string;
  asset: "XLM" | "USDC";
  amount: string;
  note: string | null;
  paid_at: string;
  from_profile: PaymentParty | null;
  to_profile: PaymentParty | null;
};

export type RecordOutcome = { status: "created" | "existing"; payment: PaymentWire } | { status: "conflict" };

/**
 * Records a payment the server already verified on Horizon. `fromWallet` and
 * `registeredBy` come from the session. Recording the same operation again
 * returns the existing row to its sender and a conflict to anyone else.
 */
export async function recordPayment(p: q.NewPayment): Promise<RecordOutcome> {
  const created = await one<PaymentWire>(q.insertPayment(p));
  if (created) return { status: "created", payment: created };
  const existing = await one<PaymentWire>(q.paymentByOpForSender(p.opId, p.fromWallet));
  return existing ? { status: "existing", payment: existing } : { status: "conflict" };
}

export const listPayments = (wallet: string, limit = 50) =>
  run<PaymentWire>(q.paymentsOfWallet(wallet, Math.min(Math.max(limit, 1), 100)));
