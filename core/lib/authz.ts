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

export type Decision = { allowed: true } | { allowed: false; status: 401 | 403; code: string; error: string };

const ALLOWED: Decision = { allowed: true };

function deny(status: 401 | 403, code: string, error: string): Decision {
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
  return value === "owner" || value === "admin" || value === "member" ? value : null;
}
