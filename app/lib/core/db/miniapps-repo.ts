import type { MiniAppPermission } from "../../miniapp-sdk/protocol.ts";
import type { MiniAppConnectionWire } from "../miniapps.ts";
import * as sql from "./miniapps-sql.ts";
import { getPool } from "./pool.ts";
import { DbNotConfiguredError } from "./repo.ts";
import type { Query } from "./sql.ts";

/**
 * Acceso a datos de las conexiones con mini-apps. Igual que repo.ts: queries
 * parametrizadas, el perfil sale de la sesión verificada y los errores de la base
 * se lanzan tal cual (las rutas los traducen con `handled`). Server-only.
 *
 * Para verificar el PIN las rutas usan `checkPin` de repo.ts (mismo bloqueo e
 * intentos que al pagar).
 */

type Row = { app_id: string; permissions: string[]; created_at: string };

const KNOWN: readonly MiniAppPermission[] = ["perfil", "pagos", "mensajes"];

async function run<T>(query: Query): Promise<T[]> {
  const pool = getPool();
  if (!pool) throw new DbNotConfiguredError();
  const result = await pool.query(query.text, query.values);
  return result.rows as T[];
}

function toWire(row: Row): MiniAppConnectionWire {
  return {
    appId: row.app_id,
    permissions: (row.permissions ?? []).filter((p): p is MiniAppPermission => (KNOWN as readonly string[]).includes(p)),
    createdAt: row.created_at,
  };
}

export async function listConnections(profileId: string): Promise<MiniAppConnectionWire[]> {
  return (await run<Row>(sql.listMiniappConnections(profileId))).map(toWire);
}

/** Conecta (o renueva) con los permisos que el SERVIDOR le da a la app. */
export async function connectApp(
  profileId: string,
  appId: string,
  permissions: readonly MiniAppPermission[],
  pinVersion: number,
): Promise<MiniAppConnectionWire> {
  const rows = await run<Row>(sql.upsertMiniappConnection(profileId, appId, [...permissions], pinVersion));
  if (!rows[0]) throw new Error("miniapp_connection_not_saved");
  return toWire(rows[0]);
}

/** true si había una conexión activa y se revocó. */
export async function revokeConnection(profileId: string, appId: string): Promise<boolean> {
  return (await run(sql.revokeMiniappConnection(profileId, appId))).length > 0;
}
