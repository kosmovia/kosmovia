import type { AttachmentKind, AttachmentScope, FileVariant } from "./attachments-rules.ts";
import * as sql from "./db/attachments-sql.ts";
import { getPool } from "./db/pool.ts";
import { DbNotConfiguredError } from "./db/repo.ts";

/**
 * Dónde viven los BYTES de los archivos adjuntos (y su miniatura).
 *
 * Hoy: Postgres (la base de prueba), en las columnas `data` y `thumb` de `attachments`. Es lo más simple y
 * gratis para arrancar, y tiene un costo: cada byte subido también viaja en las copias de seguridad, ocupa
 * almacenamiento de la base (que es chico en un plan gratis) y se lee por la misma conexión que el chat.
 * Con el tope de 5 MB por archivo y 100 MB por perfil, unas pocas decenas de perfiles activos ya llenan un
 * plan gratis. Conviene migrar a Supabase Storage o Cloudflare R2 antes de abrir la app a más gente.
 *
 * Para migrar solo se reemplaza esta interfaz: la fila de `attachments` (permisos, cuotas, vínculo con el
 * mensaje) se queda en Postgres con `data`/`thumb` en null y una clave del objeto, y `save`/`load` suben y
 * bajan los bytes del otro servicio. Rutas, repo, mensajes y la interfaz de pantalla no cambian.
 * Server-only.
 */

/** Lo que devuelve subir un archivo: sin bytes. */
export type AttachmentWire = {
  id: string;
  kind: AttachmentKind;
  name: string;
  size: number;
  width: number | null;
  height: number | null;
};

/** Un archivo guardado, con lo necesario para decidir el permiso de lectura. */
export type StoredFile = {
  id: string;
  uploader_id: string;
  scope: AttachmentScope;
  channel_id: string | null;
  dm_thread_id: string | null;
  message_id: string | null;
  kind: AttachmentKind;
  mime: string;
  name: string;
  /** null si la variante pedida no existe (el PDF no tiene miniatura). */
  bytes: Buffer | null;
};

export interface AttachmentStore {
  readonly backend: string;
  /**
   * Guarda un archivo YA procesado y su fila. Devuelve null si quien sube no puede escribir en ese destino
   * (la regla se repite dentro del INSERT). Las cuotas se aplican aquí y lanzan quota_exceeded.
   */
  save(scope: AttachmentScope, row: sql.NewAttachmentRow): Promise<AttachmentWire | null>;
  /** Un archivo (o su miniatura) tal como se guardó. null si no existe. Quien llama decide el permiso. */
  load(id: string, variant: FileVariant): Promise<StoredFile | null>;
}

async function run<T>(query: { text: string; values: unknown[] }): Promise<T[]> {
  const pool = getPool();
  if (!pool) throw new DbNotConfiguredError();
  return (await pool.query(query.text, query.values)).rows as T[];
}

/** Implementación actual: bytea en la tabla `attachments`. */
export const postgresAttachmentStore: AttachmentStore = {
  backend: "postgres",
  async save(scope, row) {
    const query = scope === "channel" ? sql.insertChannelAttachment(row) : sql.insertDmAttachment(row);
    return (await run<AttachmentWire>(query))[0] ?? null;
  },
  async load(id, variant) {
    return (await run<StoredFile>(sql.attachmentWithBytes(id, variant)))[0] ?? null;
  },
};

let current: AttachmentStore = postgresAttachmentStore;

export function getAttachmentStore(): AttachmentStore {
  return current;
}

/** Cambia el almacén (el día que existan R2 o Supabase Storage; también sirve en pruebas). */
export function setAttachmentStore(store: AttachmentStore | null): void {
  current = store ?? postgresAttachmentStore;
}
