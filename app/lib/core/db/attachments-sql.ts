import type { Query } from "./sql.ts";

/**
 * SQL de los archivos adjuntos, como constructores puros (mismas reglas que sql.ts: el texto solo lleva
 * constantes y `$n`; todo dato del usuario viaja en `values`). Las reglas de escritura se repiten dentro
 * del propio INSERT, igual que en los mensajes: el permiso no se puede esquivar con una carrera.
 */

/** Roles que ven y escriben en canales privados (igual que sql.ts). */
const STAFF_ROLES = "('owner', 'admin', 'moderator')";
const ISO_US = (column: string): string => `to_char(${column} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const AUTHOR_JSON =
  "json_build_object('id', a.id, 'username', a.username, 'display_name', a.display_name, 'avatar_seed', a.avatar_seed, 'avatar_style', a.avatar_style)";

export interface NewAttachmentRow {
  uploaderId: string;
  /** Id del canal o de la conversación. */
  targetId: string;
  kind: "image" | "pdf";
  mime: string;
  name: string;
  size: number;
  width: number | null;
  height: number | null;
  data: Buffer;
  thumb: Buffer | null;
}

/** Lo que se devuelve al subir y al consultar: nada de bytes. */
export const ATTACHMENT_WIRE = "a.id, a.kind, a.name, a.size, a.width, a.height";

const insertValues = (r: NewAttachmentRow): unknown[] => [
  r.uploaderId, r.targetId, r.kind, r.mime, r.name, r.size, r.width, r.height, r.data, r.thumb,
];

const INSERT_COLUMNS = "uploader_id, scope, %target%, kind, mime, name, size, width, height, data, thumb";
const INSERT_VALUES = "$3::text, $4::text, $5::text, $6::int, $7::int, $8::int, $9::bytea, $10::bytea";
const RETURNING = "returning id, kind, name, size, width, height";

/**
 * Sube a un canal: solo si quien sube es miembro, puede escribir ahí (anuncios: owner/admin; privado:
 * staff) y no es el canal de comprobantes de pago. Cero filas = no permitido.
 */
export const insertChannelAttachment = (r: NewAttachmentRow): Query => ({
  text:
    `insert into public.attachments (${INSERT_COLUMNS.replace("%target%", "channel_id")}) ` +
    `select $1::uuid, 'channel', ch.id, ${INSERT_VALUES} ` +
    "from public.channels ch join public.members mem on mem.community_id = ch.community_id and mem.profile_id = $1::uuid " +
    "where ch.id = $2::uuid and ch.type <> 'payments' and (ch.type <> 'announcement' or mem.role in ('owner', 'admin')) " +
    `and (ch.visibility = 'public' or mem.role in ${STAFF_ROLES}) ${RETURNING}`,
  values: insertValues(r),
});

/** Sube a una conversación directa: solo si quien sube es una de las dos personas. Cero filas = no permitido. */
export const insertDmAttachment = (r: NewAttachmentRow): Query => ({
  text:
    `insert into public.attachments (${INSERT_COLUMNS.replace("%target%", "dm_thread_id")}) ` +
    `select $1::uuid, 'dm', t.id, ${INSERT_VALUES} ` +
    "from public.dm_threads t where t.id = $2::uuid and (t.user_a = $1::uuid or t.user_b = $1::uuid) " +
    RETURNING,
  values: insertValues(r),
});

/** Datos de varios archivos (sin bytes): para validar el vínculo y decidir permisos de lectura. */
export const attachmentRows = (ids: string[]): Query => ({
  text:
    "select a.id, a.uploader_id, a.scope, a.channel_id, a.dm_thread_id, a.message_id, a.kind, a.name, a.size, a.width, a.height " +
    "from public.attachments a where a.id = any($1::uuid[])",
  values: [ids],
});

/** Un archivo con sus bytes (el archivo o la miniatura) y lo necesario para decidir el permiso. */
export const attachmentWithBytes = (id: string, variant: "file" | "thumb"): Query => ({
  text:
    "select a.id, a.uploader_id, a.scope, a.channel_id, a.dm_thread_id, a.message_id, a.kind, a.mime, a.name, " +
    "(case when $2::text = 'thumb' then a.thumb else a.data end) as bytes " +
    "from public.attachments a where a.id = $1::uuid",
  values: [id, variant],
});

/** Quita un archivo que todavía no va en ningún mensaje, solo si lo subió quien llama. Cero filas = nada que quitar. */
export const deleteUnlinkedAttachment = (id: string, uploaderId: string): Query => ({
  text:
    "delete from public.attachments a where a.id = $1::uuid and a.uploader_id = $2::uuid and a.message_id is null returning a.id",
  values: [id, uploaderId],
});

/** Los archivos marcados que se pueden vincular: del autor, de este destino y sin usar. `for update` cierra la carrera de doble uso. */
const okCte = (scope: "channel" | "dm"): string =>
  "ok as (select a.id from public.attachments a where a.id = any($4::uuid[]) and a.uploader_id = $2::uuid " +
  `and a.scope = '${scope}' and a.${scope === "channel" ? "channel_id" : "dm_thread_id"} = $1::uuid and a.message_id is null for update)`;

const LINK_CTE = "lnk as (update public.attachments a set message_id = ins.id from ins where a.id in (select id from ok) returning a.id)";

/**
 * Publica un mensaje de canal y vincula sus archivos en UNA sola sentencia: el mensaje se escribe solo si
 * hay permiso (la misma regla de insertMessage, y no en el canal de pagos) y si los `$5` archivos marcados
 * siguen siendo del autor, de este canal y sin usar. Cero filas = no se pudo (permiso o carrera).
 */
export const insertChannelMessageWithAttachments = (channelId: string, authorId: string, content: string, ids: string[]): Query => ({
  text:
    `with ${okCte("channel")}, ` +
    "ins as (insert into public.messages (channel_id, author_id, content) " +
    "select ch.id, $2::uuid, $3 from public.channels ch " +
    "join public.members mem on mem.community_id = ch.community_id and mem.profile_id = $2::uuid " +
    "where ch.id = $1::uuid and ch.type <> 'payments' and (ch.type <> 'announcement' or mem.role in ('owner', 'admin')) " +
    `and (ch.visibility = 'public' or mem.role in ${STAFF_ROLES}) and (select count(*) from ok) = $5::int ` +
    "returning id, channel_id, author_id, content, created_at, edited_at), " +
    `${LINK_CTE} ` +
    `select m.id, m.channel_id, m.author_id, m.content, ${ISO_US("m.created_at")} as created_at, ${ISO_US("m.edited_at")} as edited_at, ${AUTHOR_JSON} as author ` +
    "from ins m join public.profiles a on a.id = m.author_id",
  values: [channelId, authorId, content, ids, ids.length],
});

/** Lo mismo en una conversación directa: además sube `last_message_at` y marca leído para el autor. */
export const insertDmMessageWithAttachments = (threadId: string, authorId: string, content: string, ids: string[]): Query => ({
  text:
    `with ${okCte("dm")}, ` +
    "ins as (insert into public.dm_messages (thread_id, author_id, content) " +
    "select t.id, $2::uuid, $3::text from public.dm_threads t " +
    "where t.id = $1::uuid and (t.user_a = $2::uuid or t.user_b = $2::uuid) and (select count(*) from ok) = $5::int " +
    "returning id, thread_id, author_id, content, created_at, edited_at), " +
    "bump as (update public.dm_threads t set last_message_at = now(), " +
    "a_read_at = case when t.user_a = $2::uuid then now() else t.a_read_at end, " +
    "b_read_at = case when t.user_b = $2::uuid then now() else t.b_read_at end " +
    "where t.id = $1::uuid and exists (select 1 from ins) returning t.id), " +
    `${LINK_CTE} ` +
    `select m.id, m.thread_id, m.thread_id as channel_id, m.author_id, m.content, ${ISO_US("m.created_at")} as created_at, ${ISO_US("m.edited_at")} as edited_at, ${AUTHOR_JSON} as author ` +
    "from ins m join public.profiles a on a.id = m.author_id",
  values: [threadId, authorId, content, ids, ids.length],
});

/** El contenido actual de un mensaje propio de canal (para comprobar que la edición no toca los marcadores). */
export const ownChannelMessageContent = (channelId: string, messageId: string, authorId: string): Query => ({
  text: "select m.content from public.messages m where m.id = $2::uuid and m.channel_id = $1::uuid and m.author_id = $3::uuid",
  values: [channelId, messageId, authorId],
});

export const ownDmMessageContent = (threadId: string, messageId: string, authorId: string): Query => ({
  text: "select m.content from public.dm_messages m where m.id = $2::uuid and m.thread_id = $1::uuid and m.author_id = $3::uuid",
  values: [threadId, messageId, authorId],
});
