import { DEFAULT_PREFS, MAX_SUBSCRIPTIONS_PER_PROFILE, type MentionCandidate, type NotificationPrefs } from "../push-rules.ts";
import { getPool } from "./pool.ts";
import * as s from "./push-sql.ts";
import type { Query } from "./sql.ts";
import { DbNotConfiguredError } from "./repo.ts";

/**
 * Acceso a datos de las notificaciones push. Mismas reglas que repo.ts: consultas
 * parametrizadas y el perfil siempre sale de la sesión. Server-only.
 */

async function run<T = Record<string, unknown>>(query: Query): Promise<T[]> {
  const pool = getPool();
  if (!pool) throw new DbNotConfiguredError();
  return (await pool.query(query.text, query.values)).rows as T[];
}

export type StoredSubscription = { endpoint: string; p256dh: string; auth: string };

export async function saveSubscription(
  profileId: string,
  sub: { endpoint: string; p256dh: string; auth: string; userAgent: string | null },
): Promise<void> {
  await run(s.upsertSubscription(profileId, sub));
  await run(s.trimSubscriptions(profileId, MAX_SUBSCRIPTIONS_PER_PROFILE));
}

export async function removeSubscription(profileId: string, endpoint: string): Promise<void> {
  await run(s.deleteSubscription(profileId, endpoint));
}

export async function removeDeadEndpoint(endpoint: string): Promise<void> {
  await run(s.deleteDeadEndpoint(endpoint));
}

export async function subscriptionsOf(profileId: string): Promise<StoredSubscription[]> {
  return run<StoredSubscription>(s.listSubscriptions(profileId));
}

export async function touchSubscription(endpoint: string): Promise<void> {
  await run(s.touchSubscription(endpoint));
}

export async function getPrefs(profileId: string): Promise<NotificationPrefs> {
  const row = (await run<NotificationPrefs>(s.getPrefs(profileId)))[0];
  return row ? { payments: row.payments, dms: row.dms, mentions: row.mentions } : { ...DEFAULT_PREFS };
}

export async function setPrefs(profileId: string, patch: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
  const row = (await run<NotificationPrefs>(s.upsertPrefs(profileId, patch)))[0];
  return row ? { payments: row.payments, dms: row.dms, mentions: row.mentions } : { ...DEFAULT_PREFS, ...patch };
}

export async function usernameOf(profileId: string): Promise<string | null> {
  return (await run<{ username: string }>(s.usernameOf(profileId)))[0]?.username ?? null;
}

export async function dmRecipient(
  threadId: string,
  senderId: string,
): Promise<{ recipientId: string; senderUsername: string } | null> {
  const row = (await run<{ recipient_id: string; sender_username: string }>(s.dmRecipient(threadId, senderId)))[0];
  return row ? { recipientId: row.recipient_id, senderUsername: row.sender_username } : null;
}

export async function mentionCandidates(communityId: string, usernames: string[]): Promise<MentionCandidate[]> {
  if (usernames.length === 0) return [];
  return run<MentionCandidate>(s.mentionCandidates(communityId, usernames));
}
