import type { MemberRole } from "./mappers.ts";

/**
 * Who may do what in a community, as pure functions of the caller's role
 * (`null` = not a member) and the channel type. They mirror the RLS policies
 * of supabase/migrations/0001_stage_a.sql so the "api" backend, which has no
 * RLS, enforces the same rules in the server. The SQL in lib/db/sql.ts repeats
 * the post rule inside the INSERT, so a race can't slip past these checks.
 */

export type ChannelType = "text" | "announcement";
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

/** `text`: any member. `announcement`: owner and admin only. */
export function canPostInChannel(role: Role, channelType: ChannelType): Decision {
  if (role === null) return deny(403, "not_member", "Únete a la comunidad para escribir.");
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
export function isChannelType(value: unknown): value is ChannelType {
  return value === "text" || value === "announcement";
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
 * Borrar un canal: owner y admin, y nunca #general (400 `general_protected`).
 * `channelName` es el nombre guardado (minúsculas, sin #).
 */
export function canDeleteChannel(role: Role, channelName: string): Decision {
  if (role === null) return deny(403, "not_member", "Únete a la comunidad primero.");
  if (!isAdminRole(role)) return deny(403, "not_admin", "Solo owner y admin borran canales.");
  if (channelName === GENERAL_CHANNEL) return deny(400, "general_protected", "El canal #general no se puede borrar.");
  return ALLOWED;
}

/** Borrar la comunidad entera: solo el owner. */
export function canDeleteCommunity(role: Role): Decision {
  if (role === null) return deny(403, "not_member", "Únete a la comunidad primero.");
  if (role !== "owner") return deny(403, "not_owner", "Solo el owner puede borrar la comunidad.");
  return ALLOWED;
}
