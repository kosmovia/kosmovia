import type { AuthorRow, ChannelRow, CommunityRow, ProfileRow } from "../mappers.ts";
import {
  canAccessDm,
  canAssignRole,
  canChangeDmMessage,
  canCreateChannel,
  canDeleteChannel,
  canDeleteMessage,
  canEditChannel,
  canEditCommunityDescription,
  canEditMessage,
  canManageCategories,
  canOpenDm,
  canPostInChannel,
  canReadCommunity,
  canUpdateChannel,
  canViewChannel,
  channelTypeOf,
  roleOf,
  type AssignableRole,
  type ChannelType,
  type ChannelVisibility,
  type CreatableChannelType,
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

/** Cambia la descripción ('' la quita): owner/admin. Regla pura y de nuevo dentro del UPDATE. */
export async function setCommunityDescription(
  slug: string,
  profileId: string,
  description: string,
): Promise<Guarded<CommunityRow> | { ok: false; notFound: true }> {
  const community = await getCommunityBySlug(slug);
  if (!community) return { ok: false, notFound: true };
  const decision = canEditCommunityDescription(await getRole(community.id, profileId));
  if (!decision.allowed) return { ok: false, denied: decision };
  const row = await one<CommunityRow>(q.updateCommunityDescription(slug, profileId, description));
  return row ? { ok: true, value: row } : { ok: false, denied: FORBIDDEN };
}

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
const INVALID_CATEGORY: Extract<Decision, { allowed: false }> = {
  allowed: false,
  status: 400,
  code: "invalid_category",
  error: "Esa categoría no es de esta comunidad.",
};

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

export type CategoryRow = { id: string; community_id: string; name: string; position: number };

/**
 * Channels and categories of a community, for its members only. Private
 * channels are left out unless the caller is owner/admin/moderator (the rule
 * is inside the SELECT). Channels by position then creation; categories by position.
 */
export async function listChannels(
  communityId: string,
  profileId: string,
): Promise<Guarded<{ channels: ChannelRow[]; categories: CategoryRow[] }>> {
  const decision = canReadCommunity(await getRole(communityId, profileId));
  if (!decision.allowed) return { ok: false, denied: decision };
  const [channels, categories] = await Promise.all([
    run<ChannelRow>(q.listChannels(communityId, profileId)),
    run<CategoryRow>(q.listCategories(communityId, profileId)),
  ]);
  return { ok: true, value: { channels, categories } };
}

/** Owner and admin only. A `category_id` must belong to the same community (400 `invalid_category`). */
export async function createChannel(
  communityId: string,
  profileId: string,
  input: {
    name: string;
    topic: string | null;
    type: CreatableChannelType;
    emoji?: string | null;
    categoryId?: string | null;
    visibility?: ChannelVisibility;
  },
): Promise<Guarded<ChannelRow>> {
  const decision = canCreateChannel(await getRole(communityId, profileId));
  if (!decision.allowed) return { ok: false, denied: decision };
  if (input.categoryId && !(await one(q.categoryInCommunity(input.categoryId, communityId)))) {
    return { ok: false, denied: INVALID_CATEGORY };
  }
  const row = await one<ChannelRow>(q.insertChannel({ communityId, ...input }));
  return row ? { ok: true, value: row } : { ok: false, denied: { allowed: false, status: 403, code: "forbidden", error: "No permitido." } };
}

/** Borra un canal y sus mensajes: owner/admin, nunca #general. */
export async function deleteChannel(channelId: string, profileId: string): Promise<Guarded<true> | { ok: false; notFound: true }> {
  const access = await getChannelAccess(channelId, profileId);
  if (!access.found) return { ok: false, notFound: true };
  const decision = canDeleteChannel(access.role, access.name, access.type);
  if (!decision.allowed) return { ok: false, denied: decision };
  const row = await one(q.deleteChannel(channelId, profileId));
  return row ? { ok: true, value: true } : { ok: false, denied: FORBIDDEN };
}

/** Cambia el tema del canal (null lo quita): owner/admin. Regla pura y de nuevo dentro del UPDATE. */
export async function updateChannelTopic(
  channelId: string,
  profileId: string,
  topic: string | null,
): Promise<Guarded<ChannelRow> | { ok: false; notFound: true }> {
  const access = await getChannelAccess(channelId, profileId);
  if (!access.found) return { ok: false, notFound: true };
  const decision = canEditChannel(access.role);
  if (!decision.allowed) return { ok: false, denied: decision };
  const row = await one<ChannelRow>(q.updateChannelTopic(channelId, profileId, topic));
  return row ? { ok: true, value: row } : { ok: false, denied: FORBIDDEN };
}

/**
 * Edita el canal (cualquier subconjunto de tema, emoji, categoría, visibilidad,
 * posición): owner/admin. Regla pura y de nuevo dentro del UPDATE; una categoría de
 * otra comunidad es 400 `invalid_category`.
 */
export async function updateChannel(
  channelId: string,
  profileId: string,
  patch: q.ChannelPatch,
): Promise<Guarded<ChannelRow> | { ok: false; notFound: true }> {
  const access = await getChannelAccess(channelId, profileId);
  if (!access.found) return { ok: false, notFound: true };
  const decision = canUpdateChannel(access.role, access.name, access.type, patch);
  if (!decision.allowed) return { ok: false, denied: decision };
  if (patch.categoryId && !(await one(q.categoryInCommunity(patch.categoryId, access.communityId)))) {
    return { ok: false, denied: INVALID_CATEGORY };
  }
  const row = await one<ChannelRow>(q.updateChannel(channelId, profileId, patch));
  return row ? { ok: true, value: row } : { ok: false, denied: FORBIDDEN };
}

// --------------------------------------------------------------- categories

type CategoryAccess = { id: string; community_id: string; role: string | null };

/** Crea una categoría al final: owner/admin. Regla pura y de nuevo dentro del INSERT. */
export async function createCategory(communityId: string, profileId: string, name: string): Promise<Guarded<CategoryRow>> {
  const decision = canManageCategories(await getRole(communityId, profileId));
  if (!decision.allowed) return { ok: false, denied: decision };
  const row = await one<CategoryRow>(q.insertCategory(communityId, profileId, name));
  return row ? { ok: true, value: row } : { ok: false, denied: FORBIDDEN };
}

/** Renombra o reordena una categoría: owner/admin. */
export async function updateCategory(
  categoryId: string,
  profileId: string,
  patch: q.CategoryPatch,
): Promise<Guarded<CategoryRow> | { ok: false; notFound: true }> {
  const cat = await one<CategoryAccess>(q.categoryWithRole(categoryId, profileId));
  if (!cat) return { ok: false, notFound: true };
  const decision = canManageCategories(roleOf(cat.role));
  if (!decision.allowed) return { ok: false, denied: decision };
  const row = await one<CategoryRow>(q.updateCategory(categoryId, profileId, patch));
  return row ? { ok: true, value: row } : { ok: false, denied: FORBIDDEN };
}

/** Borra una categoría (sus canales quedan sin categoría): owner/admin. */
export async function removeCategory(categoryId: string, profileId: string): Promise<Guarded<true> | { ok: false; notFound: true }> {
  const cat = await one<CategoryAccess>(q.categoryWithRole(categoryId, profileId));
  if (!cat) return { ok: false, notFound: true };
  const decision = canManageCategories(roleOf(cat.role));
  if (!decision.allowed) return { ok: false, denied: decision };
  const row = await one(q.deleteCategory(categoryId, profileId));
  return row ? { ok: true, value: true } : { ok: false, denied: FORBIDDEN };
}

// ----------------------------------------------------------------- messages

export type MessageWire = {
  id: string;
  channel_id: string;
  author_id: string;
  content: string;
  created_at: string;
  /** null = nunca se editó. */
  edited_at: string | null;
  author: AuthorRow;
};

export type ChannelAccess =
  | { found: false }
  | { found: true; communityId: string; name: string; type: ChannelType; visibility: ChannelVisibility; role: Role };

export async function getChannelAccess(channelId: string, profileId: string): Promise<ChannelAccess> {
  const row = await one<{ community_id: string; name: string; type: string; visibility?: string; role: string | null }>(
    q.channelWithRole(channelId, profileId),
  );
  if (!row) return { found: false };
  return {
    found: true,
    communityId: row.community_id,
    name: row.name,
    type: channelTypeOf(row.type),
    visibility: row.visibility === "private" ? "private" : "public",
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
  const decision = canViewChannel(access.role, access.visibility);
  // Un canal privado no se revela a quien no puede verlo: para esa persona no existe.
  if (!decision.allowed) return decision.code === "private_channel" ? { ok: false, notFound: true } : { ok: false, denied: decision };

  const limit = q.pageSize(page.limit);
  if (page.after) {
    return { ok: true, value: await run<MessageWire>(q.messagesAfter(channelId, profileId, page.after, limit)) };
  }
  const rows = await run<MessageWire>(q.messagesNewest(channelId, profileId, limit, page.before));
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
  const decision = canPostInChannel(access.role, access.type, access.visibility);
  if (!decision.allowed) return decision.code === "private_channel" ? { ok: false, notFound: true } : { ok: false, denied: decision };

  const row = await one<MessageWire>(q.insertMessage(channelId, profileId, content));
  if (!row) {
    return { ok: false, denied: { allowed: false, status: 403, code: "forbidden", error: "No puedes escribir en este canal." } };
  }
  return { ok: true, value: row };
}

type MessageAccess = { id: string; author_id: string; community_id: string; visibility?: string; role: string | null };

/** A private channel's messages do not exist for someone who cannot see the channel. */
function hiddenByPrivacy(msg: MessageAccess): boolean {
  return !canViewChannel(roleOf(msg.role), msg.visibility === "private" ? "private" : "public").allowed && msg.role !== null;
}

/** Edita el mensaje: solo su autor. Regla pura y de nuevo dentro del UPDATE. `content` ya viene validado. */
export async function editMessage(
  channelId: string,
  messageId: string,
  profileId: string,
  content: string,
): Promise<Guarded<MessageWire> | { ok: false; notFound: true }> {
  const msg = await one<MessageAccess>(q.messageWithRole(channelId, messageId, profileId));
  if (!msg || hiddenByPrivacy(msg)) return { ok: false, notFound: true };
  const decision = canEditMessage(roleOf(msg.role), msg.author_id, profileId);
  if (!decision.allowed) return { ok: false, denied: decision };
  const row = await one<MessageWire>(q.updateMessage(channelId, messageId, profileId, content));
  return row ? { ok: true, value: row } : { ok: false, denied: FORBIDDEN };
}

/** Borra el mensaje: su autor u owner/admin/moderator. Regla pura y de nuevo dentro del DELETE. */
export async function removeMessage(
  channelId: string,
  messageId: string,
  profileId: string,
): Promise<Guarded<true> | { ok: false; notFound: true }> {
  const msg = await one<MessageAccess>(q.messageWithRole(channelId, messageId, profileId));
  if (!msg || hiddenByPrivacy(msg)) return { ok: false, notFound: true };
  const decision = canDeleteMessage(roleOf(msg.role), msg.author_id, profileId);
  if (!decision.allowed) return { ok: false, denied: decision };
  const row = await one(q.deleteMessage(channelId, messageId, profileId));
  return row ? { ok: true, value: true } : { ok: false, denied: FORBIDDEN };
}

// ----------------------------------------------------------------- payments

// ----------------------------------------------------------- direct messages

export type DmThreadWire = {
  id: string;
  other: AuthorRow & { wallet: string };
  last_message: { content: string; created_at: string; author_id: string } | null;
  unread: number;
  last_message_at: string;
};

export type DmMessageWire = MessageWire & { thread_id: string };

const NOT_PARTICIPANT_404 = { ok: false, notFound: true } as const;

/** The caller's threads, newest first. */
export const listDmThreads = (profileId: string) => run<DmThreadWire>(q.listDmThreads(profileId));

/**
 * Gets or creates the thread between the caller and `otherId`. The pure rule
 * (not yourself, shared community) runs first for the reason and again inside
 * the INSERT. `created` tells a new thread (201) from an existing one (200).
 */
export async function openDmThread(
  actorId: string,
  otherId: string,
): Promise<Guarded<{ thread: DmThreadWire; created: boolean }>> {
  const shared = actorId === otherId ? false : (await one<{ shared: boolean }>(q.sharedCommunity(actorId, otherId)))?.shared === true;
  const decision = canOpenDm(actorId, otherId, shared);
  if (!decision.allowed) return { ok: false, denied: decision };
  const inserted = await one<{ id: string }>(q.insertDmThread(actorId, otherId));
  let threadId = inserted?.id;
  if (!threadId) {
    threadId = (await one<{ id: string }>(q.dmThreadOfPair(actorId, otherId)))?.id;
    if (!threadId) return { ok: false, denied: FORBIDDEN };
  }
  const thread = await one<DmThreadWire>(q.dmThreadForUser(threadId, actorId));
  return thread ? { ok: true, value: { thread, created: inserted !== null } } : { ok: false, denied: FORBIDDEN };
}

type DmThreadRow = { id: string; user_a: string; user_b: string };

/** The thread if the caller is one of its two people; null for "no such thread" and "not yours" alike. */
async function ownDmThread(threadId: string, profileId: string): Promise<DmThreadRow | null> {
  const thread = await one<DmThreadRow>(q.dmThreadById(threadId));
  if (!thread || !canAccessDm(thread.user_a, thread.user_b, profileId).allowed) return null;
  return thread;
}

/**
 * Messages of a DM thread, oldest first, with the same cursors as a channel
 * (`before`, `after`, `limit`). Marks the thread read for the caller. A thread
 * that is not theirs answers as not found, so its existence is not revealed.
 */
export async function listDmMessages(
  threadId: string,
  profileId: string,
  page: MessagePage = {},
): Promise<{ ok: true; value: DmMessageWire[] } | { ok: false; notFound: true }> {
  if (!(await ownDmThread(threadId, profileId))) return NOT_PARTICIPANT_404;
  const limit = q.pageSize(page.limit);
  let rows: DmMessageWire[];
  if (page.after) {
    rows = await run<DmMessageWire>(q.dmMessagesAfter(threadId, profileId, page.after, limit));
  } else {
    rows = (await run<DmMessageWire>(q.dmMessagesNewest(threadId, profileId, limit, page.before))).reverse();
  }
  await run(q.markDmRead(threadId, profileId));
  return { ok: true, value: rows };
}

/** Posts a DM as `profileId` (a participant); `content` is already validated. */
export async function postDmMessage(
  threadId: string,
  profileId: string,
  content: string,
): Promise<Guarded<DmMessageWire> | { ok: false; notFound: true }> {
  if (!(await ownDmThread(threadId, profileId))) return NOT_PARTICIPANT_404;
  const row = await one<DmMessageWire>(q.insertDmMessage(threadId, profileId, content));
  return row ? { ok: true, value: row } : { ok: false, denied: FORBIDDEN };
}

type DmMessageAccess = { id: string; author_id: string; user_a: string; user_b: string };

/** Edits a DM message: only its author. Rule checked in code and again inside the UPDATE. */
export async function editDmMessage(
  threadId: string,
  messageId: string,
  profileId: string,
  content: string,
): Promise<Guarded<DmMessageWire> | { ok: false; notFound: true }> {
  const msg = await one<DmMessageAccess>(q.dmMessageAccess(threadId, messageId));
  if (!msg || !canAccessDm(msg.user_a, msg.user_b, profileId).allowed) return NOT_PARTICIPANT_404;
  const decision = canChangeDmMessage(msg.user_a, msg.user_b, msg.author_id, profileId);
  if (!decision.allowed) return { ok: false, denied: decision };
  const row = await one<DmMessageWire>(q.updateDmMessage(threadId, messageId, profileId, content));
  return row ? { ok: true, value: row } : { ok: false, denied: FORBIDDEN };
}

/** Deletes a DM message (hard delete): only its author. */
export async function removeDmMessage(
  threadId: string,
  messageId: string,
  profileId: string,
): Promise<Guarded<true> | { ok: false; notFound: true }> {
  const msg = await one<DmMessageAccess>(q.dmMessageAccess(threadId, messageId));
  if (!msg || !canAccessDm(msg.user_a, msg.user_b, profileId).allowed) return NOT_PARTICIPANT_404;
  const decision = canChangeDmMessage(msg.user_a, msg.user_b, msg.author_id, profileId);
  if (!decision.allowed) return { ok: false, denied: decision };
  const row = await one(q.deleteDmMessage(threadId, messageId, profileId));
  return row ? { ok: true, value: true } : { ok: false, denied: FORBIDDEN };
}

export type PaymentParty ={ username: string; display_name: string; avatar_seed: string | null; avatar_style: string | null };

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
