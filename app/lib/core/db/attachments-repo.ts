import { canAccessDm, canPostInChannel, canViewChannel } from "../authz.ts";
import {
  canReadAttachment,
  checkLinkable,
  sameMarkers,
  type AttachmentLinkRow,
  type AttachmentScope,
  type FileVariant,
} from "../attachments-rules.ts";
import { getAttachmentStore, type AttachmentWire, type StoredFile } from "../attachments-store.ts";
import * as s from "./attachments-sql.ts";
import { getPool } from "./pool.ts";
import { DbNotConfiguredError, getChannelAccess, type DmMessageWire, type MessageWire } from "./repo.ts";
import * as q from "./sql.ts";

/**
 * Acceso a datos de los archivos adjuntos. Mismas reglas que repo.ts: consultas parametrizadas, el perfil
 * siempre sale de la sesión, y las reglas puras (authz.ts / attachments-rules.ts) se aplican en código y
 * otra vez dentro de la propia sentencia. Los bytes pasan por AttachmentStore. Server-only.
 */

async function run<T = Record<string, unknown>>(query: q.Query): Promise<T[]> {
  const pool = getPool();
  if (!pool) throw new DbNotConfiguredError();
  return (await pool.query(query.text, query.values)).rows as T[];
}

const one = async <T = Record<string, unknown>>(query: q.Query): Promise<T | null> => (await run<T>(query))[0] ?? null;

export type Target = { scope: AttachmentScope; id: string };
export type Denied = { allowed: false; status: 400 | 401 | 403 | 409; code: string; error: string };
export type Access = { ok: true } | { ok: false; notFound: true } | { ok: false; denied: Denied };

const NOT_FOUND = { ok: false, notFound: true } as const;
const OK = { ok: true } as const;

const denied = (status: Denied["status"], code: string, error: string): { ok: false; denied: Denied } => ({
  ok: false,
  denied: { allowed: false, status, code, error },
});

/** Una conversación si quien llama es una de las dos personas; null si no existe o no es suya. */
async function ownDm(threadId: string, profileId: string): Promise<boolean> {
  const thread = await one<{ id: string; user_a: string; user_b: string }>(q.dmThreadById(threadId));
  return thread !== null && canAccessDm(thread.user_a, thread.user_b, profileId).allowed;
}

/**
 * ¿Puede esta persona SUBIR a este canal o conversación? Mismo permiso que escribir (miembro; #anuncios solo
 * owner/admin; canal privado solo staff; un canal privado ajeno "no existe") y, además, nada en el canal de
 * comprobantes de pago. Una conversación ajena también "no existe".
 */
export async function authorizeWrite(target: Target, profileId: string): Promise<Access> {
  if (target.scope === "dm") return (await ownDm(target.id, profileId)) ? OK : NOT_FOUND;
  const access = await getChannelAccess(target.id, profileId);
  if (!access.found) return NOT_FOUND;
  const decision = canPostInChannel(access.role, access.type, access.visibility);
  if (!decision.allowed) return decision.code === "private_channel" ? NOT_FOUND : { ok: false, denied: decision };
  if (access.type === "payments") {
    return denied(403, "payments_channel", "En este canal no se pueden adjuntar archivos.");
  }
  return OK;
}

/** ¿Puede esta persona LEER lo que hay en este canal o conversación? */
async function containerReadable(scope: AttachmentScope, targetId: string | null, profileId: string): Promise<boolean> {
  if (!targetId) return false;
  if (scope === "dm") return ownDm(targetId, profileId);
  const access = await getChannelAccess(targetId, profileId);
  return access.found && canViewChannel(access.role, access.visibility).allowed;
}

type ReadRow = { uploader_id: string; message_id: string | null; scope: AttachmentScope; channel_id: string | null; dm_thread_id: string | null };

/** Permiso de lectura de un archivo, con una memoria por destino para no repetir consultas. */
async function mayRead(row: ReadRow, profileId: string, memo: Map<string, boolean>): Promise<boolean> {
  if (row.message_id === null) return canReadAttachment(row, profileId, false);
  const targetId = row.scope === "channel" ? row.channel_id : row.dm_thread_id;
  const key = `${row.scope}:${targetId}`;
  let readable = memo.get(key);
  if (readable === undefined) {
    readable = await containerReadable(row.scope, targetId, profileId);
    memo.set(key, readable);
  }
  return canReadAttachment(row, profileId, readable);
}

/** El archivo o su miniatura para quien puede leerlo. Todo lo demás (no existe, ajeno, sin permiso) es "no encontrado". */
export async function readFileFor(
  id: string,
  profileId: string,
  variant: FileVariant,
): Promise<{ ok: true; file: StoredFile & { bytes: Buffer } } | { ok: false }> {
  const file = await getAttachmentStore().load(id, variant);
  if (!file || !file.bytes) return { ok: false };
  if (!(await mayRead(file, profileId, new Map()))) return { ok: false };
  return { ok: true, file: file as StoredFile & { bytes: Buffer } };
}

/** Datos (sin bytes) de los archivos que esta persona puede leer, en el orden pedido. Los demás se omiten. */
export async function describeFor(ids: string[], profileId: string): Promise<AttachmentWire[]> {
  if (ids.length === 0) return [];
  const rows = await run<ReadRow & AttachmentWire>(s.attachmentRows(ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const memo = new Map<string, boolean>();
  const out: AttachmentWire[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || !(await mayRead(row, profileId, memo))) continue;
    out.push({ id: row.id, kind: row.kind, name: row.name, size: row.size, width: row.width, height: row.height });
  }
  return out;
}

/** Quita un archivo que todavía no va en ningún mensaje (la "x" de la bandeja). Solo quien lo subió. */
export async function discard(id: string, profileId: string): Promise<boolean> {
  return (await one(s.deleteUnlinkedAttachment(id, profileId))) !== null;
}

type PostResult<T> = { ok: true; value: T } | { ok: false; notFound: true } | { ok: false; denied: Denied };

const UNAVAILABLE = (): { ok: false; denied: Denied } =>
  denied(409, "attachment_unavailable", "Uno de los archivos ya no está disponible. Quítalo y súbelo de nuevo.");

/**
 * Publica un mensaje de canal con archivos (`ids` = los marcadores ya validados: máx. 4, sin repetir).
 * Primero el permiso de escribir y la comprobación de cada id (para dar un aviso claro); después una sola
 * sentencia que escribe el mensaje y vincula los archivos solo si todo sigue igual.
 */
export async function postChannelMessageWithAttachments(
  channelId: string,
  profileId: string,
  content: string,
  ids: string[],
): Promise<PostResult<MessageWire>> {
  const access = await authorizeWrite({ scope: "channel", id: channelId }, profileId);
  if (!access.ok) return access;
  const check = checkLinkable(await run<AttachmentLinkRow>(s.attachmentRows(ids)), ids, { profileId, scope: "channel", targetId: channelId });
  if (!check.ok) return denied(400, "attachment_invalid", check.error);
  const row = await one<MessageWire>(s.insertChannelMessageWithAttachments(channelId, profileId, content, ids));
  return row ? { ok: true, value: row } : UNAVAILABLE();
}

/** Lo mismo en una conversación directa. */
export async function postDmMessageWithAttachments(
  threadId: string,
  profileId: string,
  content: string,
  ids: string[],
): Promise<PostResult<DmMessageWire>> {
  const access = await authorizeWrite({ scope: "dm", id: threadId }, profileId);
  if (!access.ok) return access;
  const check = checkLinkable(await run<AttachmentLinkRow>(s.attachmentRows(ids)), ids, { profileId, scope: "dm", targetId: threadId });
  if (!check.ok) return denied(400, "attachment_invalid", check.error);
  const row = await one<DmMessageWire>(s.insertDmMessageWithAttachments(threadId, profileId, content, ids));
  return row ? { ok: true, value: row } : UNAVAILABLE();
}

/**
 * Editar un mensaje no puede quitar, agregar ni cambiar archivos: los marcadores del texto nuevo tienen que
 * ser exactamente los del mensaje guardado. Si el mensaje no es del autor o no existe, deja pasar: la edición
 * normal responde 404 o 403 como siempre.
 */
export async function editKeepsMarkers(target: Target, messageId: string, authorId: string, newContent: string): Promise<boolean> {
  const query =
    target.scope === "channel"
      ? s.ownChannelMessageContent(target.id, messageId, authorId)
      : s.ownDmMessageContent(target.id, messageId, authorId);
  const row = await one<{ content: string }>(query);
  return row === null || sameMarkers(row.content, newContent);
}
