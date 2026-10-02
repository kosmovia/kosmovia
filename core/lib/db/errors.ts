import { quotaMessage } from "../mappers.ts";

/**
 * Turns a database error into the HTTP answer the client understands, without
 * ever echoing the driver's message (it can carry SQL, hosts or values).
 * Pure: tests feed it plain objects shaped like pg errors.
 */

export interface DbErrorLike {
  code?: string;
  message?: string;
  constraint?: string;
}

export interface ApiFailure {
  status: number;
  code: string;
  error: string;
}

export function classifyDbError(err: unknown): ApiFailure {
  const e = (err ?? {}) as DbErrorLike;

  // quota_exceeded:* raised by the triggers (SQLSTATE P0001).
  const quota = e.code === "P0001" ? quotaMessage(e) : null;
  if (quota) return { status: 429, code: "quota_exceeded", error: quota };

  if (e.code === "23505") {
    const c = e.constraint ?? "";
    if (c === "profiles_username_lower_key") return { status: 409, code: "username_taken", error: "Ese @usuario ya está tomado" };
    if (c === "profiles_x_handle_lower_key") {
      return { status: 409, code: "x_taken", error: "Esa cuenta de X ya está vinculada a otro perfil" };
    }
    if (c === "profiles_kosmonauta_key") {
      return { status: 409, code: "avatar_taken", error: "Ese Kosmonauta ya es de otra persona. Cambia al menos un rasgo." };
    }
    if (c === "communities_slug_key") return { status: 409, code: "slug_taken", error: "Ese enlace ya está en uso" };
    if (c === "channels_community_name_key") return { status: 409, code: "channel_taken", error: "Ya existe un canal con ese nombre." };
    if (c === "profiles_pkey" || c === "profiles_wallet_key") {
      return { status: 409, code: "profile_exists", error: "Ya tienes un perfil creado." };
    }
    return { status: 409, code: "conflict", error: "Ese dato ya existe." };
  }
  // Foreign key: the caller has no profile row yet.
  if (e.code === "23503") {
    return { status: 409, code: "no_profile", error: "Crea tu perfil antes de continuar." };
  }
  // CHECK violation: input that slipped past the route validators.
  if (e.code === "23514") {
    return { status: 400, code: "invalid_input", error: "Revisa los datos: no cumplen el formato." };
  }
  // Invalid text representation (e.g. a malformed uuid).
  if (e.code === "22P02") return { status: 400, code: "invalid_input", error: "Datos inválidos." };
  return { status: 500, code: "db_error", error: "No se pudo completar la operación. Intenta de nuevo." };
}

/** The `code` of a driver error for logs (never its message). */
export function dbErrorCode(err: unknown): string {
  const code = (err as DbErrorLike | null)?.code;
  return typeof code === "string" ? code : "unknown";
}
