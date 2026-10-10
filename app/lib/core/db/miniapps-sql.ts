import type { Query } from "./sql.ts";

/**
 * SQL de las conexiones con mini-apps (migración 0013). Constructores puros, igual
 * que sql.ts: el texto son constantes y `$n`; lo que viene del usuario va en `values`.
 * Vive en su propio archivo para no tocar sql.ts.
 */

const ISO_US = (column: string) => `to_char(${column} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const COLUMNS = `app_id, permissions, ${ISO_US("created_at")} as created_at`;

/** Las conexiones activas de una persona, la más reciente primero. */
export const listMiniappConnections = (profileId: string): Query => ({
  text:
    `select ${COLUMNS} from public.miniapp_connections ` +
    "where profile_id = $1 and revoked_at is null order by created_at desc, app_id",
  values: [profileId],
});

/**
 * Crea la conexión, o la renueva si ya había una activa (permisos, versión del PIN
 * y fecha: la persona volvió a autorizar). Un solo statement: la unicidad parcial
 * (profile_id, app_id) where revoked_at is null resuelve la carrera entre dos pedidos.
 */
export const upsertMiniappConnection = (profileId: string, appId: string, permissions: string[], pinVersion: number): Query => ({
  text:
    "insert into public.miniapp_connections (profile_id, app_id, permissions, pin_version) values ($1, $2, $3::text[], $4) " +
    "on conflict (profile_id, app_id) where revoked_at is null " +
    "do update set permissions = excluded.permissions, pin_version = excluded.pin_version, created_at = now() " +
    `returning ${COLUMNS}`,
  values: [profileId, appId, permissions, pinVersion],
});

/** Revoca la conexión activa (si no hay, no hace nada). */
export const revokeMiniappConnection = (profileId: string, appId: string): Query => ({
  text:
    "update public.miniapp_connections set revoked_at = now() " +
    "where profile_id = $1 and app_id = $2 and revoked_at is null returning app_id",
  values: [profileId, appId],
});
