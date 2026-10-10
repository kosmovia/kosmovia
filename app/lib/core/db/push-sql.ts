import type { Query } from "./sql.ts";
import type { NotificationPrefs } from "../push-rules.ts";

/**
 * SQL de las notificaciones push (migración 0014). Solo constantes y `$n`:
 * lo que llega de afuera viaja en `values`. Server-only.
 */

/** Guarda o renueva la suscripción de un dispositivo; si el endpoint era de otro perfil, pasa a este. */
export const upsertSubscription = (
  profileId: string,
  s: { endpoint: string; p256dh: string; auth: string; userAgent: string | null },
): Query => ({
  text:
    "insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, user_agent) " +
    "values ($1, $2, $3, $4, $5) " +
    "on conflict (endpoint) do update set profile_id = excluded.profile_id, p256dh = excluded.p256dh, " +
    "auth = excluded.auth, user_agent = excluded.user_agent, last_used_at = now() " +
    "returning id",
  values: [profileId, s.endpoint, s.p256dh, s.auth, s.userAgent],
});

/** Deja las `keep` suscripciones más recientes del perfil y borra el resto. */
export const trimSubscriptions = (profileId: string, keep: number): Query => ({
  text:
    "delete from public.push_subscriptions where profile_id = $1 and id not in (" +
    "select id from public.push_subscriptions where profile_id = $1 order by last_used_at desc, id limit $2)",
  values: [profileId, keep],
});

export const deleteSubscription = (profileId: string, endpoint: string): Query => ({
  text: "delete from public.push_subscriptions where profile_id = $1 and endpoint = $2",
  values: [profileId, endpoint],
});

/** Borrado por endpoint sin perfil: solo para el servidor cuando el servicio de push dice 404/410. */
export const deleteDeadEndpoint = (endpoint: string): Query => ({
  text: "delete from public.push_subscriptions where endpoint = $1",
  values: [endpoint],
});

export const listSubscriptions = (profileId: string): Query => ({
  text: "select endpoint, p256dh, auth from public.push_subscriptions where profile_id = $1 order by last_used_at desc limit 20",
  values: [profileId],
});

export const touchSubscription = (endpoint: string): Query => ({
  text: "update public.push_subscriptions set last_used_at = now() where endpoint = $1",
  values: [endpoint],
});

export const getPrefs = (profileId: string): Query => ({
  text: "select payments, dms, mentions from public.notification_prefs where profile_id = $1",
  values: [profileId],
});

/** Mezcla un subconjunto de preferencias; lo que no viene queda como estaba (o activado si es la primera vez). */
export const upsertPrefs = (profileId: string, patch: Partial<NotificationPrefs>): Query => ({
  text:
    "insert into public.notification_prefs (profile_id, payments, dms, mentions) " +
    "values ($1, coalesce($2::boolean, true), coalesce($3::boolean, true), coalesce($4::boolean, true)) " +
    "on conflict (profile_id) do update set " +
    "payments = coalesce($2::boolean, public.notification_prefs.payments), " +
    "dms = coalesce($3::boolean, public.notification_prefs.dms), " +
    "mentions = coalesce($4::boolean, public.notification_prefs.mentions) " +
    "returning payments, dms, mentions",
  values: [profileId, patch.payments ?? null, patch.dms ?? null, patch.mentions ?? null],
});

export const usernameOf = (profileId: string): Query => ({
  text: "select username from public.profiles where id = $1",
  values: [profileId],
});

/** El otro participante de una conversación directa y el @usuario de quien escribe. */
export const dmRecipient = (threadId: string, senderId: string): Query => ({
  text:
    "select case when t.user_a = $2::uuid then t.user_b else t.user_a end as recipient_id, s.username as sender_username " +
    "from public.dm_threads t join public.profiles s on s.id = $2::uuid " +
    "where t.id = $1 and (t.user_a = $2::uuid or t.user_b = $2::uuid)",
  values: [threadId, senderId],
});

/** Perfiles con esos @usuario y su rol en la comunidad (null = no son miembros). */
export const mentionCandidates = (communityId: string, usernames: string[]): Query => ({
  text:
    "select p.id, p.username, m.role from public.profiles p " +
    "left join public.members m on m.profile_id = p.id and m.community_id = $1 " +
    "where p.username = any($2::text[])",
  values: [communityId, usernames],
});
