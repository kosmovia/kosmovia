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
import { isUuid } from "../ids.ts";
import { newPaymentRef } from "../payments.ts";
import {
  APPROVAL_GRACE_MS,
  APPROVAL_TTL_MS,
  PIN_RESET_DELAY_MS,
  LOCK_BASE_MS,
  LOCK_MAX_MS,
  MAX_FAILED_ATTEMPTS,
  MAX_LOCK_LEVEL,
  attemptsLeft,
  hashPin,
  limitDecision,
  verifyPinHash,
} from "../pin.ts";
import { canCloseVaquita, checkContribution } from "../vaquita-rules.ts";
import * as rules from "../invoice-rules.ts";
import type { PayDecision } from "../invoice-rules.ts";
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

type TxQuery = <T = Record<string, unknown>>(query: q.Query) => Promise<T[]>;

/** BEGIN … COMMIT en una sola conexión; ROLLBACK si `fn` lanza. Solo para lo que necesita una fila bloqueada. */
async function transaction<T>(fn: (query: TxQuery) => Promise<T>): Promise<T> {
  const pool = getPool();
  if (!pool) throw new DbNotConfiguredError();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(async <R,>(query: q.Query) => (await client.query(query.text, query.values)).rows as R[]);
    await client.query("commit");
    return result;
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      // La conexión ya se perdió: el error original es el que importa.
    }
    throw err;
  } finally {
    client.release();
  }
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

/**
 * Si `profileId` puede pagar el cobro del mensaje `messageId`. Se consulta antes
 * de dejar que el cliente mande la plata, para no cobrar dos veces el mismo
 * cobro ni dejar que lo pague quien no corresponde. Es una comprobación previa:
 * lo que de verdad impide el registro doble es el índice único de la 0018.
 */
export async function canPayInvoice(messageId: string, profileId: string): Promise<PayDecision> {
  if (!isUuid(messageId)) {
    return { allowed: false, status: 400, code: "invalid_invoice", error: "Ese cobro no existe." };
  }
  const row = await one<{
    content: string;
    author_id: string;
    visibility: string | null;
    role: string | null;
    already_paid: boolean;
  }>(q.invoiceForPayment(messageId, profileId));
  if (!row) {
    return { allowed: false, status: 404, code: "invoice_not_found", error: "Ese cobro no existe." };
  }
  return rules.canPayInvoice({
    content: row.content,
    authorId: row.author_id,
    payerId: profileId,
    role: row.role,
    visibility: row.visibility === "private" ? "private" : "public",
    alreadyPaid: row.already_paid === true,
  });
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
  /** Pagó sin permiso válido del PIN. Solo lo ve quien envió; para quien recibe siempre es false. */
  unverified: boolean;
  from_profile: PaymentParty | null;
  to_profile: PaymentParty | null;
};

export type RecordOutcome = { status: "created" | "existing"; payment: PaymentWire } | { status: "conflict" };

/** Se lanza dentro de la transacción de `recordPayment` para deshacer el permiso consumido cuando la operación ya estaba registrada. */
class AlreadyRecorded extends Error {}

/**
 * Records a payment the server already verified on Horizon. `fromWallet` and
 * `registeredBy` come from the session. Recording the same operation again
 * returns the existing row to its sender and a conflict to anyone else.
 *
 * `approvalId` (lo que mandó el cliente, sin confiar en él) es el permiso del
 * PIN. Se consume solo si es de este perfil y coincide con destino, activo y monto
 * exacto del pago verificado, el MEMO del pago en Horizon es el que el servidor generó
 * al aprobar, está sin usar, dentro de su vida y no revocado antes de que el pago
 * cerrara. Si no, el pago se guarda igual (el dinero ya se movió) con
 * `unverified = true`: nunca se rechaza.
 *
 * Orden: primero la idempotencia (¿ya existe esa operación?), luego UNA transacción
 * con consumir el permiso + insertar el pago + ligarlos. Si la operación se registró
 * en paralelo, todo se deshace junto y se devuelve el registro existente; si ese
 * quedó `unverified` y ahora llega el permiso correcto, se completa (ver `completeLate`).
 * Un error de transporte nunca "libera" el permiso a mano: el rollback lo deshace.
 */
export async function recordPayment(p: Omit<q.NewPayment, "unverified">): Promise<RecordOutcome> {
  const candidate = p.approvalId && isUuid(p.approvalId) ? p.approvalId : null;

  const claim = async (query: TxQuery): Promise<string | null> => {
    if (!candidate) return null;
    const row = (
      await query<{ id: string }>(
        q.claimApproval({
          approvalId: candidate,
          profileId: p.registeredBy,
          toWallet: p.toWallet,
          asset: p.asset,
          amount: p.amount,
          memo: p.memo ?? null,
          paidAt: p.paidAt,
          graceMs: APPROVAL_GRACE_MS,
        }),
      )
    )[0];
    return row?.id ?? null;
  };

  /**
   * El registro ya existía. Si quedó `unverified` (otro pedido lo guardó antes, sin
   * permiso) y este trae el permiso correcto: se bloquea el registro, se consume el
   * permiso y se actualiza `approval_id`/`unverified` en una transacción.
   */
  const completeLate = async (existing: PaymentWire): Promise<RecordOutcome> => {
    if (!existing.unverified || !candidate) return { status: "existing", payment: existing };
    const upgraded = await transaction(async (query) => {
      const locked = (await query<{ id: string; unverified: boolean }>(q.lockPaymentOfSender(p.opId, p.fromWallet)))[0];
      if (!locked || !locked.unverified) return null;
      const claimed = await claim(query);
      if (!claimed) return null;
      await query(q.verifyPayment(locked.id, claimed));
      await query(q.linkApproval(claimed, locked.id));
      return (await query<PaymentWire>(q.paymentByOpForSender(p.opId, p.fromWallet)))[0] ?? null;
    });
    return { status: "existing", payment: upgraded ?? existing };
  };

  const already = await one<PaymentWire>(q.paymentByOpForSender(p.opId, p.fromWallet));
  if (already) return completeLate(already);

  try {
    const created = await transaction(async (query) => {
      const claimed = await claim(query);
      const inserted = (await query<PaymentWire>(q.insertPayment({ ...p, approvalId: claimed, unverified: claimed === null })))[0];
      if (!inserted) throw new AlreadyRecorded();
      if (claimed) await query(q.linkApproval(claimed, inserted.id));
      return inserted;
    });
    return { status: "created", payment: created };
  } catch (err) {
    if (!(err instanceof AlreadyRecorded)) throw err;
    // Otra petición registró esa operación justo antes: se devuelve la suya (o conflicto si es de otra persona).
    const existing = await one<PaymentWire>(q.paymentByOpForSender(p.opId, p.fromWallet));
    return existing ? completeLate(existing) : { status: "conflict" };
  }
}

export const listPayments = (wallet: string, limit = 50) =>
  run<PaymentWire>(q.paymentsOfWallet(wallet, Math.min(Math.max(limit, 1), 100)));

// ------------------------------------------------------------- payment security

export type SecurityAsset = "USDC" | "XLM";

/** Igual que `SecurityStatus` de services/securityService.ts (el contrato de la UI). */
export type SecurityStatusWire = {
  hasPin: boolean;
  lockedUntil: string | null;
  /** Cuándo se activa el PIN nuevo de un "olvidé mi PIN" pendiente; null si no hay. */
  pendingPinAt: string | null;
  dailyLimit: Record<SecurityAsset, number>;
  spentToday: Record<SecurityAsset, number>;
};

type SecurityRow = {
  has_pin: boolean;
  locked_until: string | null;
  pending_pin_at: string | null;
  daily_limit_usdc: string;
  daily_limit_xlm: string;
};

/** Límites que usa la base cuando todavía no hay fila (los mismos DEFAULT de la migración). */
const DEFAULT_LIMITS: Record<SecurityAsset, string> = { USDC: "100", XLM: "1000" };

const LOCK_POLICY: q.LockPolicy = {
  maxAttempts: MAX_FAILED_ATTEMPTS,
  baseMs: LOCK_BASE_MS,
  maxMs: LOCK_MAX_MS,
  maxLevel: MAX_LOCK_LEVEL,
};

export async function getSecurityStatus(profileId: string): Promise<SecurityStatusWire> {
  // Un reset pendiente que ya cumplió sus 24 h se activa aquí (perezoso, sin cron).
  await run(q.activatePendingPin(profileId));
  const [row, spent] = await Promise.all([
    one<SecurityRow>(q.securityRow(profileId)),
    run<{ asset: string; spent: string }>(q.approvedLast24h(profileId, APPROVAL_GRACE_MS)),
  ]);
  const spentOf = (asset: SecurityAsset) => Number(spent.find((s) => s.asset === asset)?.spent ?? 0);
  return {
    hasPin: row?.has_pin === true,
    lockedUntil: row?.locked_until ?? null,
    pendingPinAt: row?.pending_pin_at ?? null,
    dailyLimit: {
      USDC: Number(row?.daily_limit_usdc ?? DEFAULT_LIMITS.USDC),
      XLM: Number(row?.daily_limit_xlm ?? DEFAULT_LIMITS.XLM),
    },
    spentToday: { USDC: spentOf("USDC"), XLM: spentOf("XLM") },
  };
}

export type PinOutcome =
  | { ok: true; pinVersion: number }
  | { ok: false; reason: "no_pin" }
  | { ok: false; reason: "locked"; lockedUntil: string }
  | { ok: false; reason: "wrong"; attemptsLeft: number };

type ReservedAttempt = {
  pin_hash: string;
  pin_salt: string;
  pin_version: number;
  failed_attempts: number;
  locked: boolean;
  locked_until: string | null;
};

/**
 * Verifica el PIN de `profileId`. TODO en una transacción por perfil, con la fila
 * de seguridad bloqueada (`for update`): activa un reset pendiente que ya venció,
 * reserva el intento (un UPDATE que se niega si hay bloqueo vigente), verifica el
 * hash (scrypt, ~50 ms con el lock tomado) y limpia o deja los fallos. Dos pedidos
 * del mismo perfil no se intercalan, así un acierto nunca borra fallos de otros
 * intentos ni el PIN correcto salta un bloqueo. Devuelve la versión del PIN con la
 * que se verificó: las acciones siguientes deben exigir que siga siendo la vigente.
 * `secret` es SESSION_SECRET (el pepper).
 */
export async function checkPin(profileId: string, pin: string, secret: Buffer): Promise<PinOutcome> {
  return transaction<PinOutcome>(async (query) => {
    if ((await query(q.lockSecurityForPin(profileId))).length === 0) return { ok: false, reason: "no_pin" };
    await query(q.activatePendingPin(profileId));
    const reserved = (await query<ReservedAttempt>(q.reservePinAttempt(profileId, LOCK_POLICY)))[0];
    if (!reserved) {
      // Nada que reservar: sin PIN, o bloqueado.
      const state = (await query<SecurityRow>(q.securityRow(profileId)))[0];
      if (!state || !state.has_pin) return { ok: false, reason: "no_pin" };
      if (state.locked_until) return { ok: false, reason: "locked", lockedUntil: state.locked_until };
      throw new Error("pin_state_unstable");
    }
    const matches = await verifyPinHash(pin, secret, { hash: reserved.pin_hash, salt: reserved.pin_salt });
    if (matches) {
      await query(q.clearPinFailures(profileId));
      return { ok: true, pinVersion: reserved.pin_version };
    }
    if (reserved.locked && reserved.locked_until) return { ok: false, reason: "locked", lockedUntil: reserved.locked_until };
    return { ok: false, reason: "wrong", attemptsLeft: attemptsLeft(reserved.failed_attempts) };
  });
}

/** Crea el primer PIN; false si ya había uno (otro pedido se adelantó). */
export async function createPinHash(profileId: string, pin: string, secret: Buffer): Promise<boolean> {
  const stored = await hashPin(pin, secret);
  return (await one(q.createPin(profileId, stored.hash, stored.salt))) !== null;
}

/**
 * Cambia el PIN (el actual ya se verificó en la versión `expectedVersion`). Un solo
 * statement: sube la versión, borra un reset pendiente e invalida los permisos
 * pendientes. false si el PIN cambió mientras tanto (o ya no hay).
 */
export async function changePinHash(profileId: string, pin: string, secret: Buffer, expectedVersion: number): Promise<boolean> {
  const stored = await hashPin(pin, secret);
  return (await one(q.changePin(profileId, stored.hash, stored.salt, expectedVersion))) !== null;
}

export type ResetOutcome =
  | { status: "created" }
  | { status: "pending"; pendingPinAt: string }
  | { status: "pending_exists"; pendingPinAt: string };

/**
 * "Olvidé mi PIN". Si todavía no había PIN, el primero se pone al instante. Si ya
 * había, el nuevo queda PENDIENTE y se activa a las 24 h: mientras tanto el actual
 * sigue valiendo (quien robó una sesión no se queda con la cuenta) y con él se puede
 * cancelar. Un segundo pedido mientras hay uno pendiente no lo pisa
 * (`pending_exists`): gana el primero, y quien sabe el PIN puede cancelarlo.
 */
export async function requestPinReset(profileId: string, pin: string, secret: Buffer): Promise<ResetOutcome> {
  const stored = await hashPin(pin, secret);
  return transaction<ResetOutcome>(async (query) => {
    await query(q.activatePendingPin(profileId));
    type ResetRow = { has_pin: boolean; has_pending: boolean; pending_pin_at: string | null };
    let row = (await query<ResetRow>(q.securityForReset(profileId)))[0];
    if (!row || !row.has_pin) {
      // El primer PIN solo se pone si SIGUE sin haber uno (`where pin_hash is null`): `for update` no
      // protege una fila que todavía no existe, así que otro pedido pudo crearlo entre la lectura y aquí.
      if ((await query(q.createPin(profileId, stored.hash, stored.salt)))[0]) return { status: "created" };
      // Perdió la carrera: ahora la fila existe. Se relee bajo bloqueo y sigue el flujo de PIN existente.
      row = (await query<ResetRow>(q.securityForReset(profileId)))[0];
      if (!row || !row.has_pin) throw new Error("pin_state_unstable");
    }
    if (row.has_pending && row.pending_pin_at) return { status: "pending_exists", pendingPinAt: row.pending_pin_at };
    const set = (await query<{ pending_pin_at: string }>(q.setPendingPin(profileId, stored.hash, stored.salt, PIN_RESET_DELAY_MS)))[0];
    return { status: "pending", pendingPinAt: set.pending_pin_at };
  });
}

/**
 * Cancela un reset pendiente (quien llama ya verificó el PIN actual, en la versión
 * `expectedVersion`). false si el PIN cambió mientras tanto.
 */
export async function cancelPinReset(profileId: string, expectedVersion: number): Promise<boolean> {
  return (await one(q.cancelPendingPin(profileId, expectedVersion))) !== null;
}

/** Guarda los límites ya validados si el PIN sigue en la versión verificada. false si cambió (o no hay PIN). */
export async function updateDailyLimits(
  profileId: string,
  limits: { USDC?: string; XLM?: string },
  expectedVersion: number,
): Promise<boolean> {
  return (await one(q.setDailyLimits(profileId, limits.USDC ?? null, limits.XLM ?? null, expectedVersion))) !== null;
}

export type ApprovalOutcome =
  | { ok: true; id: string; expiresAt: string; memo: string; serverNow: string }
  | { ok: false; reason: "pin_changed" }
  | { ok: false; reason: "limit_exceeded"; remaining: number };

/**
 * Crea el permiso de un pago si cabe en el límite de 24 h y el PIN sigue en la
 * versión verificada. En una transacción con la fila de seguridad bloqueada
 * (`for update`): dos permisos de la misma persona no pueden leer el mismo "ya
 * aprobado" a la vez y pasarse del límite, y un PIN cambiado entre la verificación
 * y aquí no deja crear el permiso. `amount` ya viene normalizado a 7 decimales.
 */
export async function createApproval(
  profileId: string,
  p: { toWallet: string; asset: SecurityAsset; amount: string; pinVersion: number },
): Promise<ApprovalOutcome> {
  return transaction<ApprovalOutcome>(async (query) => {
    const locked = (await query<{ daily_limit_usdc: string; daily_limit_xlm: string }>(q.lockSecurityRow(profileId, p.pinVersion)))[0];
    if (!locked) return { ok: false, reason: "pin_changed" };
    const spentRows = await query<{ asset: string; spent: string }>(q.approvedLast24h(profileId, APPROVAL_GRACE_MS));
    const spent = spentRows.find((s) => s.asset === p.asset)?.spent ?? "0";
    const limit = p.asset === "USDC" ? locked.daily_limit_usdc : locked.daily_limit_xlm;
    const decision = limitDecision(limit, spent, p.amount);
    if (!decision.ok) return { ok: false, reason: "limit_exceeded", remaining: decision.remaining };
    const memo = newPaymentRef();
    const row = (
      await query<{ id: string; expires_at: string; server_now: string }>(
        q.insertApproval({
          profileId,
          toWallet: p.toWallet,
          asset: p.asset,
          amount: p.amount,
          ttlMs: APPROVAL_TTL_MS,
          pinVersion: p.pinVersion,
          memo,
        }),
      )
    )[0];
    return { ok: true, id: row.id, expiresAt: row.expires_at, memo, serverNow: row.server_now };
  });
}

// ----------------------------------------------------------------- vaquitas

export type VaquitaWire = {
  id: string;
  community_id: string;
  title: string;
  description: string | null;
  /** Decimales como texto (7 lugares): nunca pasan por un float en el servidor. */
  goal_usdc: string;
  raised_usdc: string;
  contributors_count: number;
  deadline: string | null;
  status: "open" | "closed";
  created_at: string;
  closed_at: string | null;
  creator_wallet: string;
  creator: AuthorRow;
};

export type VaquitaContributionWire = {
  id: string;
  amount_usdc: string;
  tx_hash: string;
  created_at: string;
  contributor: AuthorRow;
};

/** Una negativa con su propio estado HTTP (las de `Decision` solo llegan a 400/401/403). */
export type VaquitaDenied = { status: 400 | 403 | 404 | 409 | 422; code: string; error: string };
export type VaquitaResult<T> = { ok: true; value: T } | { ok: false; denied: VaquitaDenied };

const NOT_MEMBER: VaquitaDenied = { status: 403, code: "not_member", error: "Únete a la comunidad para ver este contenido." };
const VAQUITA_NOT_FOUND: VaquitaDenied = { status: 404, code: "not_found", error: "Vaquita no encontrada." };

const VAQUITA_LIST_LIMIT = 100;
const VAQUITA_CONTRIBUTIONS_LIMIT = 200;

type VaquitaAccess = {
  id: string;
  community_id: string;
  creator_id: string;
  status: string;
  deadline: string | null;
  created_at: string;
  creator_wallet: string;
  role: string | null;
};

/** La vaquita con el rol de quien pregunta, o la negativa: no existe (404) o no es miembro (403 `not_member`). */
async function vaquitaAccess(
  id: string,
  profileId: string,
): Promise<{ ok: true; value: VaquitaAccess } | { ok: false; denied: VaquitaDenied }> {
  if (!isUuid(id)) return { ok: false, denied: VAQUITA_NOT_FOUND };
  const row = await one<VaquitaAccess>(q.vaquitaWithRole(id, profileId));
  if (!row) return { ok: false, denied: VAQUITA_NOT_FOUND };
  if (!canReadCommunity(roleOf(row.role)).allowed) return { ok: false, denied: NOT_MEMBER };
  return { ok: true, value: row };
}

/** Las vaquitas de la comunidad, solo para sus miembros. Abiertas primero. */
export async function listVaquitas(communityId: string, profileId: string): Promise<Guarded<VaquitaWire[]>> {
  const decision = canReadCommunity(await getRole(communityId, profileId));
  if (!decision.allowed) return { ok: false, denied: decision };
  return { ok: true, value: await run<VaquitaWire>(q.listVaquitas(communityId, VAQUITA_LIST_LIMIT)) };
}

/** Crea la vaquita (cualquier miembro). La entrada ya viene validada (vaquita-rules.parseVaquitaCreate). */
export async function createVaquita(
  communityId: string,
  profileId: string,
  input: Omit<q.NewVaquita, "communityId" | "creatorId">,
): Promise<Guarded<VaquitaWire>> {
  const decision = canReadCommunity(await getRole(communityId, profileId));
  if (!decision.allowed) return { ok: false, denied: decision };
  const created = await one<{ id: string }>(q.insertVaquita({ communityId, creatorId: profileId, ...input }));
  const row = created ? await one<VaquitaWire>(q.vaquitaById(created.id)) : null;
  return row ? { ok: true, value: row } : { ok: false, denied: FORBIDDEN };
}

/** La vaquita y sus aportes, solo para miembros de su comunidad. */
export async function getVaquitaDetail(
  id: string,
  profileId: string,
): Promise<VaquitaResult<{ vaquita: VaquitaWire; contributions: VaquitaContributionWire[] }>> {
  const access = await vaquitaAccess(id, profileId);
  if (!access.ok) return access;
  const [vaquita, contributions] = await Promise.all([
    one<VaquitaWire>(q.vaquitaById(id)),
    run<VaquitaContributionWire>(q.listVaquitaContributions(id, VAQUITA_CONTRIBUTIONS_LIMIT)),
  ]);
  return vaquita ? { ok: true, value: { vaquita, contributions } } : { ok: false, denied: VAQUITA_NOT_FOUND };
}

type PaymentForVaquita = {
  id: string;
  from_wallet: string;
  to_wallet: string;
  asset: string;
  unverified: boolean;
  paid_at: string;
  linked: boolean;
};

/**
 * Vincula un pago ya registrado como aporte. Todo se decide con lo que el
 * servidor guardó (`payments`) y con la sesión, nunca con el cuerpo; la regla
 * pura da el motivo y el INSERT la aplica de nuevo (vaquita abierta, pago de la
 * sesión, a la wallet del creador, con PIN) para que un cambio entre los dos
 * pasos no la salte. Un pago ya vinculado (incluso en una carrera) es
 * `already_linked`.
 */
export async function contributeToVaquita(
  vaquitaId: string,
  session: { profileId: string; wallet: string },
  paymentId: string,
  now = Date.now(),
): Promise<VaquitaResult<{ vaquita: VaquitaWire; contribution: VaquitaContributionWire }>> {
  const access = await vaquitaAccess(vaquitaId, session.profileId);
  if (!access.ok) return access;
  const payment = isUuid(paymentId) ? await one<PaymentForVaquita>(q.paymentForVaquita(paymentId)) : null;
  if (!payment) return { ok: false, denied: { status: 404, code: "payment_not_found", error: "No encontramos ese pago." } };

  const v = access.value;
  const decision = checkContribution(
    {
      creatorId: v.creator_id,
      creatorWallet: v.creator_wallet,
      status: v.status,
      deadlineAt: v.deadline === null ? null : Date.parse(v.deadline),
      createdAt: Date.parse(v.created_at),
    },
    {
      fromWallet: payment.from_wallet,
      toWallet: payment.to_wallet,
      asset: payment.asset,
      unverified: payment.unverified,
      paidAt: Date.parse(payment.paid_at),
      linked: payment.linked,
    },
    session,
    now,
  );
  if (!decision.ok) return { ok: false, denied: { status: decision.status, code: decision.code, error: decision.error } };

  let inserted: { id: string } | null;
  try {
    inserted = await one<{ id: string }>(q.insertVaquitaContribution(vaquitaId, paymentId, session.profileId, session.wallet));
  } catch (err) {
    if ((err as { code?: string } | null)?.code === "23505") {
      return { ok: false, denied: { status: 409, code: "already_linked", error: "Ese pago ya se usó como aporte." } };
    }
    throw err;
  }
  // Cero filas: la vaquita se cerró o venció entre los dos pasos.
  if (!inserted) return { ok: false, denied: { status: 409, code: "closed", error: "Esta vaquita ya no recibe aportes." } };

  const detail = await getVaquitaDetail(vaquitaId, session.profileId);
  if (!detail.ok) return detail;
  const contribution = detail.value.contributions.find((c) => c.id === inserted?.id);
  return contribution
    ? { ok: true, value: { vaquita: detail.value.vaquita, contribution } }
    : { ok: false, denied: VAQUITA_NOT_FOUND };
}

/** Cierra la vaquita: quien la creó u owner/admin. Cerrar una ya cerrada devuelve la vaquita tal cual. */
export async function closeVaquita(id: string, profileId: string): Promise<VaquitaResult<VaquitaWire>> {
  const access = await vaquitaAccess(id, profileId);
  if (!access.ok) return access;
  if (access.value.status === "open") {
    if (!canCloseVaquita(access.value.role, access.value.creator_id, profileId)) {
      return { ok: false, denied: { status: 403, code: "forbidden", error: "Solo quien creó la vaquita o un admin puede cerrarla." } };
    }
    await run(q.closeVaquita(id, profileId));
  }
  const row = await one<VaquitaWire>(q.vaquitaById(id));
  return row ? { ok: true, value: row } : { ok: false, denied: VAQUITA_NOT_FOUND };
}

export interface VaquitaStats {
  created: number;
  open: number;
  creators: number;
  contributions: number;
  contributors: number;
  /** USDC aportado en total (decimal como texto). */
  raisedUsdc: string;
  /** Vaquitas con lo recaudado >= la meta. */
  completed: number;
}

/**
 * Métricas de uso de la Vaquita, para el dueño (no está expuesta por ninguna
 * ruta). Se consulta desde un script con DATABASE_URL puesta.
 */
export async function vaquitaStats(): Promise<VaquitaStats> {
  const row = await one<{
    created: number;
    open: number;
    creators: number;
    contributions: number;
    contributors: number;
    raised_usdc: string;
    completed: number;
  }>(q.vaquitaStats());
  return {
    created: row?.created ?? 0,
    open: row?.open ?? 0,
    creators: row?.creators ?? 0,
    contributions: row?.contributions ?? 0,
    contributors: row?.contributors ?? 0,
    raisedUsdc: row?.raised_usdc ?? "0",
    completed: row?.completed ?? 0,
  };
}
