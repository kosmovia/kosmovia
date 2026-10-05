import type { MemberRole } from "./mappers.ts";

/**
 * Who may do what in a community, as pure functions of the caller's role
 * (`null` = not a member) and the channel type. They mirror the RLS policies
 * of supabase/migrations/0001_stage_a.sql so the "api" backend, which has no
 * RLS, enforces the same rules in the server. The SQL in lib/db/sql.ts repeats
 * the post rule inside the INSERT, so a race can't slip past these checks.
 */

/** `payments` = #verificacion-pagos: lo escribe la app (comprobantes), no se crea a mano. */
export type ChannelType = "text" | "announcement" | "payments";
/** Los tipos que una persona puede pedir al crear un canal. */
export type CreatableChannelType = "text" | "announcement";
/** `private`: solo owner, admin y moderator lo ven, lo leen y escriben. */
export type ChannelVisibility = "public" | "private";
export type Role = MemberRole | null;

export type Decision = { allowed: true } | { allowed: false; status: 400 | 401 | 403; code: string; error: string };

const ALLOWED: Decision = { allowed: true };

function deny(status: 400 | 401 | 403, code: string, error: string): Decision {
  return { allowed: false, status, code, error };
}

export function isAdminRole(role: Role): boolean {
  return role === "owner" || role === "admin";
}

/** Channels, members and messages are visible to members only. */
export function canReadCommunity(role: Role): Decision {
  return role === null ? deny(403, "not_member", "Únete a la comunidad para ver este contenido.") : ALLOWED;
}

/** Roles que ven los canales privados: owner, admin y moderator. */
export function canSeePrivateChannels(role: Role): boolean {
  return role === "owner" || role === "admin" || role === "moderator";
}

/**
 * Ver, listar y leer un canal: miembros; si es privado, solo owner/admin/moderator
 * (403 `private_channel`; el repo lo responde como 404 para no revelar que existe).
 */
export function canViewChannel(role: Role, visibility: ChannelVisibility = "public"): Decision {
  if (role === null) return deny(403, "not_member", "Únete a la comunidad para ver este contenido.");
  if (visibility === "private" && !canSeePrivateChannels(role)) {
    return deny(403, "private_channel", "Este canal es privado.");
  }
  return ALLOWED;
}

/**
 * `text` y `payments`: cualquier miembro (la app publica comprobantes en
 * `payments`; el chat de ahí lo oculta la UI). `announcement`: owner y admin.
 * Un canal privado solo lo escribe owner/admin/moderator.
 */
export function canPostInChannel(role: Role, channelType: ChannelType, visibility: ChannelVisibility = "public"): Decision {
  if (role === null) return deny(403, "not_member", "Únete a la comunidad para escribir.");
  const view = canViewChannel(role, visibility);
  if (!view.allowed) return view;
  if (channelType === "announcement" && !isAdminRole(role)) {
    return deny(403, "announcement_readonly", "Solo owner y admin escriben en este canal.");
  }
  return ALLOWED;
}

export function canCreateChannel(role: Role): Decision {
  if (role === null) return deny(403, "not_member", "Únete a la comunidad primero.");
  if (!isAdminRole(role)) return deny(403, "not_admin", "Solo owner y admin crean canales.");
  return ALLOWED;
}

/** A channel type the caller asks for is only accepted if it is one we know. */
export function isChannelType(value: unknown): value is CreatableChannelType {
  return value === "text" || value === "announcement";
}

export function isChannelVisibility(value: unknown): value is ChannelVisibility {
  return value === "public" || value === "private";
}

/** Tipo guardado en la base -> ChannelType (lo desconocido cuenta como `text`). */
export function channelTypeOf(value: string | null | undefined): ChannelType {
  return value === "announcement" || value === "payments" ? value : "text";
}

/** Maps what the database returns (`role` is text) to a role, or null. */
export function roleOf(value: string | null | undefined): Role {
  return value === "owner" || value === "admin" || value === "moderator" || value === "member" ? value : null;
}

// ------------------------------------------------------------------- roles

/** Roles que la API de roles puede asignar. 'owner' nunca se asigna (no hay traspaso). */
export type AssignableRole = "admin" | "moderator" | "member";

export function isAssignableRole(value: unknown): value is AssignableRole {
  return value === "admin" || value === "moderator" || value === "member";
}

/** El canal que nunca se borra. */
export const GENERAL_CHANNEL = "general";

/**
 * Cambiar el rol de otro miembro.
 * - owner: hace o quita admins, y asigna moderator/member a cualquiera que no sea owner.
 * - admin: solo asigna moderator/member y solo a quien hoy es moderator/member
 *   (no toca a otros admins ni crea admins).
 * - moderator, member y quien no es miembro: nada.
 * Nadie cambia al owner (es único, el de communities.owner_id) y 'owner' no se
 * puede asignar. `targetCurrentRole` null = el objetivo no es miembro.
 * El SQL de setMemberRole repite estas reglas dentro del UPDATE.
 */
export function canAssignRole(actorRole: Role, targetCurrentRole: Role, newRole: unknown): Decision {
  if (actorRole === null) return deny(403, "not_member", "Únete a la comunidad primero.");
  if (!isAdminRole(actorRole)) return deny(403, "not_admin", "Solo owner y admin cambian roles.");
  if (!isAssignableRole(newRole)) return deny(403, "invalid_role", "Ese rol no se puede asignar.");
  if (targetCurrentRole === null) return deny(403, "target_not_member", "Esa persona no es miembro de la comunidad.");
  if (targetCurrentRole === "owner") return deny(403, "owner_protected", "El rol del owner no se puede cambiar.");
  if (actorRole === "owner") return ALLOWED;
  if (targetCurrentRole === "admin" || newRole === "admin") {
    return deny(403, "owner_only", "Solo el owner puede hacer o quitar admins.");
  }
  return ALLOWED;
}

/**
 * Borrar un canal: owner y admin, y nunca #general (400 `general_protected`) ni el
 * canal de pagos (400 `payments_protected`). `channelName` es el nombre guardado
 * (minúsculas, sin #). #cobros sí se puede borrar.
 */
export function canDeleteChannel(role: Role, channelName: string, channelType: ChannelType = "text"): Decision {
  if (role === null) return deny(403, "not_member", "Únete a la comunidad primero.");
  if (!isAdminRole(role)) return deny(403, "not_admin", "Solo owner y admin borran canales.");
  if (channelName === GENERAL_CHANNEL) return deny(400, "general_protected", "El canal #general no se puede borrar.");
  if (channelType === "payments") return deny(400, "payments_protected", "El canal de verificación de pagos no se puede borrar.");
  return ALLOWED;
}

/** Cambios que PATCH /api/channels/[id] aplica (cualquier subconjunto). */
export interface ChannelEdit {
  topic?: string | null;
  emoji?: string | null;
  categoryId?: string | null;
  visibility?: ChannelVisibility;
  position?: number;
}

/**
 * Editar un canal: owner y admin. #general y el canal de pagos no pueden ser
 * privados (400 `channel_protected`): dejarían a los miembros sin ellos.
 * El SQL de updateChannel repite estas reglas dentro del UPDATE.
 */
export function canUpdateChannel(role: Role, channelName: string, channelType: ChannelType, edit: ChannelEdit): Decision {
  const base = canEditChannel(role);
  if (!base.allowed) return base;
  if (edit.visibility === "private" && (channelName === GENERAL_CHANNEL || channelType === "payments")) {
    return deny(400, "channel_protected", "Este canal no puede ser privado.");
  }
  return ALLOWED;
}

/** Crear, renombrar, reordenar y borrar categorías: owner y admin. El SQL lo repite. */
export function canManageCategories(role: Role): Decision {
  if (role === null) return deny(403, "not_member", "Únete a la comunidad primero.");
  if (!isAdminRole(role)) return deny(403, "not_admin", "Solo owner y admin gestionan las categorías.");
  return ALLOWED;
}

// ----------------------------------------------------------- mensajes directos

/**
 * Abrir un mensaje directo: no consigo mismo (400 `self_dm`) y solo si los dos
 * comparten al menos una comunidad (403 `no_shared_community`). El SQL de
 * openDmThread repite la regla de la comunidad compartida.
 */
export function canOpenDm(actorId: string, otherId: string, sharesCommunity: boolean): Decision {
  if (actorId === otherId) return deny(400, "self_dm", "No puedes escribirte a ti mismo.");
  if (!sharesCommunity) {
    return deny(403, "no_shared_community", "Solo puedes escribir a quien comparte una comunidad contigo.");
  }
  return ALLOWED;
}

/** Leer y escribir en un hilo: solo sus dos participantes (403 `not_participant`). */
export function canAccessDm(userA: string, userB: string, actorId: string): Decision {
  if (actorId !== userA && actorId !== userB) return deny(403, "not_participant", "Esta conversación no es tuya.");
  return ALLOWED;
}

/** Editar o borrar un mensaje directo: solo su autor, y dentro de un hilo propio. */
export function canChangeDmMessage(userA: string, userB: string, authorId: string, actorId: string): Decision {
  const access = canAccessDm(userA, userB, actorId);
  if (!access.allowed) return access;
  if (authorId !== actorId) return deny(403, "not_author", "Solo quien lo escribió puede cambiar el mensaje.");
  return ALLOWED;
}

/** Cambiar el tema de un canal: owner y admin. El SQL de updateChannelTopic lo repite. */
export function canEditChannel(role: Role): Decision {
  if (role === null) return deny(403, "not_member", "Únete a la comunidad primero.");
  if (!isAdminRole(role)) return deny(403, "not_admin", "Solo owner y admin editan el canal.");
  return ALLOWED;
}

/** Roles que moderan mensajes ajenos: owner, admin y moderator. */
export function isModeratorRole(role: Role): boolean {
  return role === "owner" || role === "admin" || role === "moderator";
}

/** Editar un mensaje: solo su autor (y sigue siendo miembro). Nadie edita mensajes ajenos, ni el owner. */
export function canEditMessage(role: Role, authorId: string, actorId: string): Decision {
  if (role === null) return deny(403, "not_member", "Únete a la comunidad primero.");
  if (authorId !== actorId) return deny(403, "not_author", "Solo quien lo escribió puede editar el mensaje.");
  return ALLOWED;
}

/** Borrar un mensaje: su autor, o owner/admin/moderator de la comunidad. Un miembro común no borra mensajes ajenos. */
export function canDeleteMessage(role: Role, authorId: string, actorId: string): Decision {
  if (role === null) return deny(403, "not_member", "Únete a la comunidad primero.");
  if (authorId === actorId || isModeratorRole(role)) return ALLOWED;
  return deny(403, "cannot_delete_message", "No puedes borrar este mensaje.");
}

/** Borrar la comunidad entera: solo el owner. */
export function canDeleteCommunity(role: Role): Decision {
  if (role === null) return deny(403, "not_member", "Únete a la comunidad primero.");
  if (role !== "owner") return deny(403, "not_owner", "Solo el owner puede borrar la comunidad.");
  return ALLOWED;
}

/** Cambiar la descripción de la comunidad: owner y admin. El SQL de updateCommunityDescription lo repite. */
export function canEditCommunityDescription(role: Role): Decision {
  if (role === null) return deny(403, "not_member", "Únete a la comunidad primero.");
  if (!isAdminRole(role)) return deny(403, "not_admin", "Solo owner y admin cambian la descripción.");
  return ALLOWED;
}
