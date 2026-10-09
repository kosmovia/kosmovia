/**
 * Every SQL statement the "api" backend runs, as pure builders. The text is
 * made only of constants and `$n` placeholders: user input travels in `values`
 * and never touches the text (tests/db-sql.test.mts checks it with hostile
 * input). Even the dynamic UPDATE only picks column names from fixed maps.
 *
 * The authorization rules mirror the RLS policies of supabase/migrations/0001
 * and 0002: read channels/messages = member; post = member in a `text`
 * channel, owner/admin in an `announcement` one; create channels = owner/admin;
 * author = the session profile.
 */

export interface Query {
  text: string;
  values: unknown[];
}

const PROFILE_COLUMNS =
  "p.id, p.wallet, p.username, p.display_name, p.avatar_seed, p.avatar_style, p.bio, p.trust_level, p.x_handle, p.x_verified_at, p.created_at, p.username_changed_at, p.avatar_changed_at";
const COMMUNITY_COLUMNS = "c.id, c.slug, c.name, c.icon, c.description, c.owner_id, c.created_at, c.image";
const CHANNEL_COLUMNS = "ch.id, ch.community_id, ch.name, ch.topic, ch.type, ch.category_id, ch.position, ch.visibility, ch.emoji";
const CHANNEL_RETURNING = "returning ch.id, ch.community_id, ch.name, ch.topic, ch.type, ch.category_id, ch.position, ch.visibility, ch.emoji";
/** Roles que ven y escriben en canales privados (lo mismo que canSeePrivateChannels). */
const STAFF_ROLES = "('owner', 'admin', 'moderator')";

/** ISO-8601 with microseconds, so ordering by the string equals ordering by the column. */
const ISO_US = `to_char(%s at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const isoUs = (column: string): string => ISO_US.replace("%s", column);

const AUTHOR_JSON =
  "json_build_object('id', a.id, 'username', a.username, 'display_name', a.display_name, 'avatar_seed', a.avatar_seed, 'avatar_style', a.avatar_style)";

/** What a message row looks like on the wire: MessageRow + the slim author. */
const MESSAGE_SELECT = `m.id, m.channel_id, m.author_id, m.content, ${isoUs("m.created_at")} as created_at, ${isoUs("m.edited_at")} as edited_at, ${AUTHOR_JSON} as author`;

export const MESSAGE_FROM = "from public.messages m join public.profiles a on a.id = m.author_id";

// ----------------------------------------------------------------- profiles

export const profileById = (id: string): Query => ({
  text: `select ${PROFILE_COLUMNS} from public.profiles p where p.id = $1`,
  values: [id],
});

export const profileByUsername = (username: string): Query => ({
  text: `select ${PROFILE_COLUMNS} from public.profiles p where lower(p.username) = lower($1)`,
  values: [username],
});

/** The profile that owns a Stellar address (wallet is unique). */
export const profileByWallet = (wallet: string): Query => ({
  text: `select ${PROFILE_COLUMNS} from public.profiles p where p.wallet = $1`,
  values: [wallet],
});

/** Which of these usernames (already lowercase) are taken. */
export const takenUsernames = (names: string[]): Query => ({
  text: "select lower(p.username) as username from public.profiles p where lower(p.username) = any($1::text[])",
  values: [names],
});

export interface NewProfile {
  id: string;
  wallet: string;
  username: string;
  displayName: string;
  avatarSeed: string | null;
  avatarStyle: string | null;
}

/** trust_level, x_handle and x_verified_at are never set here: they take their defaults. */
export const insertProfile = (p: NewProfile): Query => ({
  text:
    "insert into public.profiles (id, wallet, username, display_name, avatar_seed, avatar_style) " +
    "values ($1, $2, $3, $4, $5, $6) " +
    "returning id, wallet, username, display_name, avatar_seed, avatar_style, bio, trust_level, x_handle, x_verified_at, created_at, " +
      "username_changed_at, avatar_changed_at",
  values: [p.id, p.wallet, p.username, p.displayName, p.avatarSeed, p.avatarStyle],
});

export interface ProfilePatch {
  username?: string;
  displayName?: string;
  avatarSeed?: string;
  avatarStyle?: string;
  bio?: string;
}

/** The only columns a user may change on their own profile (never trust_level or the X columns). */
const PROFILE_PATCH_COLUMNS: Array<[keyof ProfilePatch, string]> = [
  ["username", "username"],
  ["displayName", "display_name"],
  ["avatarSeed", "avatar_seed"],
  ["avatarStyle", "avatar_style"],
  ["bio", "bio"],
];

/** Null when the patch is empty. */
export function updateProfile(id: string, patch: ProfilePatch): Query | null {
  const sets: string[] = [];
  const values: unknown[] = [id];
  for (const [key, column] of PROFILE_PATCH_COLUMNS) {
    const value = patch[key];
    if (value === undefined) continue;
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  }
  if (sets.length === 0) return null;
  return {
    text:
      `update public.profiles set ${sets.join(", ")} where id = $1 ` +
      "returning id, wallet, username, display_name, avatar_seed, avatar_style, bio, trust_level, x_handle, x_verified_at, created_at, " +
      "username_changed_at, avatar_changed_at",
    values,
  };
}

/**
 * X verification result. `trust_level < 2` keeps the "never touch a level-2
 * profile" rule of the Supabase verifier role, and the level is set to 1, never
 * higher. The id AND wallet must match: the row has to be the one this wallet owns.
 */
export const persistXVerification = (id: string, wallet: string, handle: string, verifiedAt: string): Query => ({
  text:
    "update public.profiles set x_handle = $3, x_verified_at = $4::timestamptz, trust_level = 1 " +
    "where id = $1 and wallet = $2 and trust_level < 2 returning id",
  values: [id, wallet, handle, verifiedAt],
});

export const profileTrustLevel = (id: string, wallet: string): Query => ({
  text: "select trust_level from public.profiles where id = $1 and wallet = $2",
  values: [id, wallet],
});

// -------------------------------------------------------------- communities

export const listCommunities = (limit: number): Query => ({
  text: `select ${COMMUNITY_COLUMNS} from public.communities c order by c.created_at desc, c.id desc limit $1`,
  values: [limit],
});

export const communityBySlug = (slug: string): Query => ({
  text: `select ${COMMUNITY_COLUMNS} from public.communities c where c.slug = $1`,
  values: [slug],
});

export const myCommunityIds = (profileId: string): Query => ({
  text: "select community_id from public.members where profile_id = $1",
  values: [profileId],
});

export interface NewCommunity {
  name: string;
  slug: string;
  description: string;
  icon: string;
  ownerId: string;
  /** data URL ya validada (lib/community-image.ts), o null. */
  image: string | null;
}

/** The AFTER INSERT trigger adds the owner as a member and creates #general and #anuncios. */
export const insertCommunity = (c: NewCommunity): Query => ({
  text:
    "insert into public.communities (name, slug, description, icon, owner_id, image) values ($1, $2, $3, $4, $5, $6) " +
    "returning id, slug, name, icon, description, owner_id, created_at, image",
  values: [c.name, c.slug, c.description, c.icon, c.ownerId, c.image],
});

/** Solo el dueño: la condición owner_id = sesión va en el WHERE. Cero filas = no es el dueño (o no existe). */
export const updateCommunityImage = (slug: string, ownerId: string, image: string | null): Query => ({
  text:
    "update public.communities set image = $3 where slug = $1 and owner_id = $2 " +
    "returning id, slug, name, icon, description, owner_id, created_at, image",
  values: [slug, ownerId, image],
});

/** Owner o admin: la condición de rol de la sesión va en el WHERE. Cero filas = no permitido (o no existe). */
export const updateCommunityDescription = (slug: string, profileId: string, description: string): Query => ({
  text:
    "update public.communities c set description = $3 where c.slug = $1 " +
    "and exists (select 1 from public.members m where m.community_id = c.id and m.profile_id = $2::uuid " +
    "and m.role in ('owner', 'admin')) " +
    "returning c.id, c.slug, c.name, c.icon, c.description, c.owner_id, c.created_at, c.image",
  values: [slug, profileId, description],
});

/** Always as 'member'; joining twice is not an error. */
export const joinCommunity = (communityId: string, profileId: string): Query => ({
  text:
    "insert into public.members (community_id, profile_id, role) values ($1, $2, 'member') " +
    "on conflict (community_id, profile_id) do nothing",
  values: [communityId, profileId],
});

export const memberRole = (communityId: string, profileId: string): Query => ({
  text: "select role from public.members where community_id = $1 and profile_id = $2",
  values: [communityId, profileId],
});

export const listMembers = (communityId: string): Query => ({
  text:
    "select m.role, m.joined_at, " +
    "json_build_object('id', p.id, 'wallet', p.wallet, 'username', p.username, 'display_name', p.display_name, " +
    "'avatar_seed', p.avatar_seed, 'avatar_style', p.avatar_style, 'bio', p.bio, 'trust_level', p.trust_level, " +
    "'x_handle', p.x_handle) as profile " +
    "from public.members m join public.profiles p on p.id = m.profile_id " +
    "where m.community_id = $1 order by m.joined_at asc, m.profile_id asc limit 500",
  values: [communityId],
});

/** Solo el dueño: el WHERE exige owner_id = sesión. Borra en cascada miembros, canales y mensajes. Cero filas = no es el dueño (o no existe). */
export const deleteCommunity = (slug: string, ownerId: string): Query => ({
  text: "delete from public.communities where slug = $1 and owner_id = $2 returning id",
  values: [slug, ownerId],
});

/**
 * Cambia el rol de un miembro, con la autorización dentro del propio UPDATE
 * (las mismas reglas de canAssignRole): el objetivo nunca es owner; quien actúa
 * es owner de la comunidad, o admin que asigna moderator/member a quien hoy es
 * moderator/member. Devuelve el miembro con su perfil; cero filas = no permitido
 * (o el miembro no existe). $3 = rol nuevo, $4 = quien actúa.
 */
export const setMemberRole = (communityId: string, targetId: string, newRole: string, actorId: string): Query => ({
  text:
    "with upd as (" +
    "update public.members t set role = $3 " +
    "where t.community_id = $1 and t.profile_id = $2 and t.role <> 'owner' and $3 in ('admin', 'moderator', 'member') " +
    "and exists (select 1 from public.members a where a.community_id = $1 and a.profile_id = $4::uuid and (" +
    "a.role = 'owner' or (a.role = 'admin' and $3 in ('moderator', 'member') and t.role in ('moderator', 'member')))) " +
    "returning t.role, t.joined_at, t.profile_id) " +
    "select u.role, u.joined_at, " +
    "json_build_object('id', p.id, 'wallet', p.wallet, 'username', p.username, 'display_name', p.display_name, " +
    "'avatar_seed', p.avatar_seed, 'avatar_style', p.avatar_style, 'bio', p.bio, 'trust_level', p.trust_level, " +
    "'x_handle', p.x_handle) as profile " +
    "from upd u join public.profiles p on p.id = u.profile_id",
  values: [communityId, targetId, newRole, actorId],
});

// ----------------------------------------------------------------- channels

/**
 * Canales de la comunidad que `viewerId` puede ver: los públicos, y los privados
 * solo si es owner/admin/moderator (la regla va dentro del SELECT). Un no miembro
 * no recibe nada. Orden: posición, luego creación.
 */
export const listChannels = (communityId: string, viewerId: string): Query => ({
  text:
    `select ${CHANNEL_COLUMNS} from public.channels ch ` +
    "join public.members vm on vm.community_id = ch.community_id and vm.profile_id = $2::uuid " +
    `where ch.community_id = $1 and (ch.visibility = 'public' or vm.role in ${STAFF_ROLES}) ` +
    "order by ch.position asc, ch.created_at asc, ch.id asc",
  values: [communityId, viewerId],
});

export interface NewChannel {
  communityId: string;
  name: string;
  topic: string | null;
  type: "text" | "announcement";
  emoji?: string | null;
  categoryId?: string | null;
  visibility?: "public" | "private";
}

/**
 * Crea el canal al final de su categoría. La categoría tiene que ser de la misma
 * comunidad (si no, cero filas). El tipo `payments` no se crea por aquí.
 */
export const insertChannel = (c: NewChannel): Query => ({
  text:
    "insert into public.channels (community_id, name, topic, type, emoji, category_id, visibility, position) " +
    "select $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::uuid, $7::text, " +
    "coalesce((select max(o.position) + 1 from public.channels o where o.community_id = $1::uuid and o.category_id is not distinct from $6::uuid), 0) " +
    "where $4::text in ('text', 'announcement') " +
    "and ($6::uuid is null or exists (select 1 from public.channel_categories k where k.id = $6::uuid and k.community_id = $1::uuid)) " +
    "returning id, community_id, name, topic, type, category_id, position, visibility, emoji",
  values: [c.communityId, c.name, c.topic, c.type, c.emoji ?? null, c.categoryId ?? null, c.visibility ?? "public"],
});

/** Campos que PATCH /api/channels/[id] puede cambiar (cualquier subconjunto, ya validados). */
export interface ChannelPatch {
  topic?: string | null;
  emoji?: string | null;
  categoryId?: string | null;
  visibility?: "public" | "private";
  position?: number;
}

const CHANNEL_PATCH_COLUMNS: Array<[keyof ChannelPatch, string, string]> = [
  ["topic", "topic", ""],
  ["emoji", "emoji", ""],
  ["categoryId", "category_id", "::uuid"],
  ["visibility", "visibility", ""],
  ["position", "position", "::integer"],
];

/**
 * Edita el canal solo si quien llama es owner/admin de su comunidad; la nueva
 * categoría debe ser de esa comunidad; #general y los canales `payments` no
 * pasan a privados (las mismas reglas de canUpdateChannel). Cero filas = no
 * permitido (o no existe). Null cuando no hay nada que cambiar. Los nombres de
 * columna salen de una lista fija; los valores viajan como parámetros.
 */
export function updateChannel(channelId: string, profileId: string, patch: ChannelPatch): Query | null {
  const sets: string[] = [];
  const values: unknown[] = [channelId, profileId];
  let categoryRef: string | null = null;
  let visibilityRef: string | null = null;
  for (const [key, column, cast] of CHANNEL_PATCH_COLUMNS) {
    const value = patch[key];
    if (value === undefined) continue;
    values.push(value);
    const ref = `$${values.length}${cast}`;
    sets.push(`${column} = ${ref}`);
    if (key === "categoryId") categoryRef = ref;
    if (key === "visibility") visibilityRef = `$${values.length}`;
  }
  if (sets.length === 0) return null;
  let guard = "";
  if (categoryRef) {
    guard +=
      ` and (${categoryRef} is null or exists (select 1 from public.channel_categories k where k.id = ${categoryRef} and k.community_id = ch.community_id))`;
  }
  if (visibilityRef) guard += ` and not (${visibilityRef} = 'private' and (ch.name = 'general' or ch.type = 'payments'))`;
  return {
    text:
      `update public.channels ch set ${sets.join(", ")} where ch.id = $1 ` +
      "and exists (select 1 from public.members m where m.community_id = ch.community_id and m.profile_id = $2::uuid " +
      `and m.role in ('owner', 'admin'))${guard} ${CHANNEL_RETURNING}`,
    values,
  };
}

/**
 * Borra un canal (y sus mensajes, en cascada) solo si quien llama es owner o admin
 * de su comunidad y no es #general ni el canal de pagos. Cero filas = no permitido (o no existe).
 */
export const deleteChannel = (channelId: string, profileId: string): Query => ({
  text:
    "delete from public.channels ch where ch.id = $1 and ch.name <> 'general' and ch.type <> 'payments' " +
    "and exists (select 1 from public.members m where m.community_id = ch.community_id and m.profile_id = $2::uuid " +
    "and m.role in ('owner', 'admin')) returning ch.id",
  values: [channelId, profileId],
});

/** Cambia el tema de un canal solo si quien llama es owner o admin de su comunidad. Cero filas = no permitido (o no existe). */
export const updateChannelTopic = (channelId: string, profileId: string, topic: string | null): Query => ({
  text:
    "update public.channels ch set topic = $3 where ch.id = $1 " +
    "and exists (select 1 from public.members m where m.community_id = ch.community_id and m.profile_id = $2::uuid " +
    "and m.role in ('owner', 'admin')) returning ch.id, ch.community_id, ch.name, ch.topic, ch.type",
  values: [channelId, profileId, topic],
});

/** The channel plus the caller's role in its community (null when not a member), in one round trip. */
export const channelWithRole = (channelId: string, profileId: string): Query => ({
  text:
    "select ch.id, ch.community_id, ch.name, ch.type, m.role, ch.visibility " +
    "from public.channels ch " +
    "left join public.members m on m.community_id = ch.community_id and m.profile_id = $2 " +
    "where ch.id = $1",
  values: [channelId, profileId],
});

// ----------------------------------------------------------------- messages

export const MAX_PAGE = 100;

/** Clamps a requested page size to 1..MAX_PAGE (default 50). */
export function pageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return 50;
  return Math.min(MAX_PAGE, Math.max(1, Math.trunc(requested)));
}

/**
 * Newest page (no cursor) or the page older than `before` (a message id of the
 * same channel). Newest first: the repo reverses it to oldest first. The cursor
 * resolves to (created_at, id) inside the database, so it cannot be forged
 * into another channel's rows and rows sharing a timestamp are neither skipped
 * nor repeated.
 */
export function messagesNewest(channelId: string, viewerId: string, limit: number, beforeId?: string): Query {
  const values: unknown[] = [channelId];
  let cursor = "";
  if (beforeId !== undefined) {
    values.push(beforeId);
    cursor =
      " and (m.created_at, m.id) < (select b.created_at, b.id from public.messages b where b.id = $2 and b.channel_id = $1)";
  }
  values.push(limit);
  const limitRef = `$${values.length}`;
  values.push(viewerId);
  return {
    text:
      `select ${MESSAGE_SELECT} ${MESSAGE_FROM} where m.channel_id = $1${cursor} ` +
      `and ${canSeeChannel("$1", `$${values.length}`)} ` +
      `order by m.created_at desc, m.id desc limit ${limitRef}`,
    values,
  };
}

/**
 * The reader is a member of the channel's community and, for a private channel,
 * owner/admin/moderator (the same rule as canViewChannel). `channelRef` and
 * `viewerRef` are `$n` placeholders.
 */
function canSeeChannel(channelRef: string, viewerRef: string): string {
  return (
    "exists (select 1 from public.channels vch " +
    `join public.members vm on vm.community_id = vch.community_id and vm.profile_id = ${viewerRef}::uuid ` +
    `where vch.id = ${channelRef} and (vch.visibility = 'public' or vm.role in ${STAFF_ROLES}))`
  );
}

/** Seconds of overlap of the polling query (see messagesAfter). */
export const AFTER_OVERLAP_SECONDS = 5;

/**
 * Messages after `afterId`, oldest first, for polling. A message's created_at
 * is the START of its transaction, so one that commits late can carry a
 * timestamp older than a message the client already has. The window therefore
 * reaches back AFTER_OVERLAP_SECONDS before the cursor; the client dedupes by id.
 */
export function messagesAfter(channelId: string, viewerId: string, afterId: string, limit: number): Query {
  return {
    text:
      `select ${MESSAGE_SELECT} ${MESSAGE_FROM} where m.channel_id = $1 ` +
      "and m.created_at > (select b.created_at from public.messages b where b.id = $2 and b.channel_id = $1) " +
      `- make_interval(secs => ${AFTER_OVERLAP_SECONDS}) ` +
      `and ${canSeeChannel("$1", "$4")} ` +
      "order by m.created_at asc, m.id asc limit $3",
    values: [channelId, afterId, limit, viewerId],
  };
}

/**
 * Insert that enforces authorization atomically (the same rule as the
 * can_post() function of 0001): a row is written only if the author is a
 * member of the channel's community and, for an `announcement` channel, is
 * owner or admin. Zero rows back = not allowed.
 */
export const insertMessage = (channelId: string, authorId: string, content: string): Query => ({
  text:
    "with ins as (" +
    "insert into public.messages (channel_id, author_id, content) " +
    "select ch.id, $2::uuid, $3 from public.channels ch " +
    "join public.members mem on mem.community_id = ch.community_id and mem.profile_id = $2::uuid " +
    "where ch.id = $1 and (ch.type <> 'announcement' or mem.role in ('owner', 'admin')) " +
    `and (ch.visibility = 'public' or mem.role in ${STAFF_ROLES}) ` +
    "returning id, channel_id, author_id, content, created_at, edited_at) " +
    `select m.id, m.channel_id, m.author_id, m.content, ${isoUs("m.created_at")} as created_at, ${isoUs("m.edited_at")} as edited_at, ${AUTHOR_JSON} as author ` +
    "from ins m join public.profiles a on a.id = m.author_id",
  values: [channelId, authorId, content],
});

/** The message (inside its channel) plus the caller's role in the channel's community (null when not a member). */
export const messageWithRole = (channelId: string, messageId: string, profileId: string): Query => ({
  text:
    "select m.id, m.author_id, ch.community_id, mem.role, ch.visibility " +
    "from public.messages m join public.channels ch on ch.id = m.channel_id " +
    "left join public.members mem on mem.community_id = ch.community_id and mem.profile_id = $3 " +
    "where m.id = $2 and m.channel_id = $1",
  values: [channelId, messageId, profileId],
});

/**
 * Edits a message's content and stamps edited_at, only if the caller is its
 * author and still a member (the same rule as canEditMessage). Zero rows back
 * = not allowed (or it no longer exists).
 */
export const updateMessage = (channelId: string, messageId: string, authorId: string, content: string): Query => ({
  text:
    "with upd as (" +
    "update public.messages m set content = $4, edited_at = now() " +
    "from public.channels ch " +
    "where m.id = $2 and m.channel_id = $1 and ch.id = m.channel_id and m.author_id = $3::uuid " +
    "and exists (select 1 from public.members mem where mem.community_id = ch.community_id and mem.profile_id = $3::uuid " +
    `and (ch.visibility = 'public' or mem.role in ${STAFF_ROLES})) ` +
    "returning m.id, m.channel_id, m.author_id, m.content, m.created_at, m.edited_at) " +
    `select m.id, m.channel_id, m.author_id, m.content, ${isoUs("m.created_at")} as created_at, ${isoUs("m.edited_at")} as edited_at, ${AUTHOR_JSON} as author ` +
    "from upd m join public.profiles a on a.id = m.author_id",
  values: [channelId, messageId, authorId, content],
});

/**
 * Hard-deletes a message if the caller is a member and either its author or
 * owner/admin/moderator of the community (the same rule as canDeleteMessage).
 * Zero rows back = not allowed (or it no longer exists).
 */
export const deleteMessage = (channelId: string, messageId: string, profileId: string): Query => ({
  text:
    "delete from public.messages m using public.channels ch " +
    "where m.id = $2 and m.channel_id = $1 and ch.id = m.channel_id " +
    "and exists (select 1 from public.members mem where mem.community_id = ch.community_id and mem.profile_id = $3::uuid " +
    "and (m.author_id = $3::uuid or mem.role in ('owner', 'admin', 'moderator')) " +
    `and (ch.visibility = 'public' or mem.role in ${STAFF_ROLES})) ` +
    "returning m.id",
  values: [channelId, messageId, profileId],
});

// --------------------------------------------------------------- categories

const CATEGORY_COLUMNS = "k.id, k.community_id, k.name, k.position";

/** Categorías de la comunidad, para sus miembros (el JOIN con members es la regla). */
export const listCategories = (communityId: string, viewerId: string): Query => ({
  text:
    `select ${CATEGORY_COLUMNS} from public.channel_categories k ` +
    "join public.members vm on vm.community_id = k.community_id and vm.profile_id = $2::uuid " +
    "where k.community_id = $1 order by k.position asc, k.created_at asc, k.id asc",
  values: [communityId, viewerId],
});

/** The category plus the caller's role in its community (null when not a member), in one round trip. */
export const categoryWithRole = (categoryId: string, profileId: string): Query => ({
  text:
    "select k.id, k.community_id, m.role from public.channel_categories k " +
    "left join public.members m on m.community_id = k.community_id and m.profile_id = $2 " +
    "where k.id = $1",
  values: [categoryId, profileId],
});

/** Una categoría de esta comunidad (para validar `category_id` antes de crear un canal). */
export const categoryInCommunity = (categoryId: string, communityId: string): Query => ({
  text: "select k.id from public.channel_categories k where k.id = $1 and k.community_id = $2",
  values: [categoryId, communityId],
});

/** Crea la categoría al final, solo si quien llama es owner/admin. Cero filas = no permitido. */
export const insertCategory = (communityId: string, profileId: string, name: string): Query => ({
  text:
    "insert into public.channel_categories (community_id, name, position) " +
    "select $1::uuid, $3::text, coalesce((select max(o.position) + 1 from public.channel_categories o where o.community_id = $1::uuid), 0) " +
    "where exists (select 1 from public.members m where m.community_id = $1::uuid and m.profile_id = $2::uuid and m.role in ('owner', 'admin')) " +
    "returning id, community_id, name, position",
  values: [communityId, profileId, name],
});

export interface CategoryPatch {
  name?: string;
  position?: number;
}

const CATEGORY_PATCH_COLUMNS: Array<[keyof CategoryPatch, string, string]> = [
  ["name", "name", "::text"],
  ["position", "position", "::integer"],
];

/** Null when the patch is empty. Owner/admin only, inside the UPDATE. */
export function updateCategory(categoryId: string, profileId: string, patch: CategoryPatch): Query | null {
  const sets: string[] = [];
  const values: unknown[] = [categoryId, profileId];
  for (const [key, column, cast] of CATEGORY_PATCH_COLUMNS) {
    const value = patch[key];
    if (value === undefined) continue;
    values.push(value);
    sets.push(`${column} = $${values.length}${cast}`);
  }
  if (sets.length === 0) return null;
  return {
    text:
      `update public.channel_categories k set ${sets.join(", ")} where k.id = $1 ` +
      "and exists (select 1 from public.members m where m.community_id = k.community_id and m.profile_id = $2::uuid " +
      "and m.role in ('owner', 'admin')) returning k.id, k.community_id, k.name, k.position",
    values,
  };
}

/** Borra la categoría (sus canales quedan sin categoría: ON DELETE SET NULL). Owner/admin only. */
export const deleteCategory = (categoryId: string, profileId: string): Query => ({
  text:
    "delete from public.channel_categories k where k.id = $1 " +
    "and exists (select 1 from public.members m where m.community_id = k.community_id and m.profile_id = $2::uuid " +
    "and m.role in ('owner', 'admin')) returning k.id",
  values: [categoryId, profileId],
});

// ------------------------------------------------------------ direct messages

/** Whether two profiles are members of at least one common community. */
export const sharedCommunity = (profileA: string, profileB: string): Query => ({
  text:
    "select exists (select 1 from public.members x join public.members y on y.community_id = x.community_id " +
    "where x.profile_id = $1::uuid and y.profile_id = $2::uuid) as shared",
  values: [profileA, profileB],
});

/**
 * Creates the thread of a pair (ordered, so (least, greatest) is unique) only if
 * they are different people who share a community (the same rule as canOpenDm);
 * an existing thread inserts nothing (`on conflict do nothing`), the repo then reads it.
 */
export const insertDmThread = (actorId: string, otherId: string): Query => ({
  text:
    "insert into public.dm_threads (user_a, user_b) " +
    "select least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid) " +
    "where $1::uuid <> $2::uuid and exists (select 1 from public.members x join public.members y on y.community_id = x.community_id " +
    "where x.profile_id = $1::uuid and y.profile_id = $2::uuid) " +
    "on conflict (user_a, user_b) do nothing returning id",
  values: [actorId, otherId],
});

/** The existing thread of a pair, whatever the order they are given in. */
export const dmThreadOfPair = (profileA: string, profileB: string): Query => ({
  text:
    "select t.id from public.dm_threads t where t.user_a = least($1::uuid, $2::uuid) and t.user_b = greatest($1::uuid, $2::uuid)",
  values: [profileA, profileB],
});

/** What a thread looks like on the wire, for `$1` = the caller. */
const DM_THREAD_SELECT =
  "t.id, " +
  "json_build_object('id', o.id, 'username', o.username, 'display_name', o.display_name, 'avatar_seed', o.avatar_seed, " +
  "'avatar_style', o.avatar_style, 'wallet', o.wallet) as other, " +
  "(select json_build_object('content', lm.content, 'created_at', " +
  `${isoUs("lm.created_at")}, 'author_id', lm.author_id) ` +
  "from public.dm_messages lm where lm.thread_id = t.id order by lm.created_at desc, lm.id desc limit 1) as last_message, " +
  "(select count(*)::int from public.dm_messages um where um.thread_id = t.id and um.author_id <> $1::uuid " +
  "and um.created_at > coalesce(case when t.user_a = $1::uuid then t.a_read_at else t.b_read_at end, '-infinity'::timestamptz)) as unread, " +
  `${isoUs("t.last_message_at")} as last_message_at`;

const DM_THREAD_FROM =
  "from public.dm_threads t join public.profiles o on o.id = case when t.user_a = $1::uuid then t.user_b else t.user_a end " +
  "where (t.user_a = $1::uuid or t.user_b = $1::uuid)";

/** The caller's threads, newest first. */
export const listDmThreads = (profileId: string): Query => ({
  text: `select ${DM_THREAD_SELECT} ${DM_THREAD_FROM} order by t.last_message_at desc, t.id desc limit 100`,
  values: [profileId],
});

/** One thread of the caller (null row when it is not theirs), in the same shape as the list. */
export const dmThreadForUser = (threadId: string, profileId: string): Query => ({
  text: `select ${DM_THREAD_SELECT} ${DM_THREAD_FROM} and t.id = $2`,
  values: [profileId, threadId],
});

/** The thread row itself (participants), for the pure checks. */
export const dmThreadById = (threadId: string): Query => ({
  text: "select t.id, t.user_a, t.user_b from public.dm_threads t where t.id = $1",
  values: [threadId],
});

/** What a DM message looks like on the wire: the channel message shape, with `thread_id` (and `channel_id` = the same id). */
const DM_MESSAGE_SELECT =
  `m.id, m.thread_id, m.thread_id as channel_id, m.author_id, m.content, ${isoUs("m.created_at")} as created_at, ${isoUs("m.edited_at")} as edited_at, ${AUTHOR_JSON} as author`;
const DM_MESSAGE_FROM = "from public.dm_messages m join public.profiles a on a.id = m.author_id";

/** The caller is one of the two participants of `$1` (the same rule as canAccessDm). `viewerRef` is a `$n`. */
const dmParticipant = (threadRef: string, viewerRef: string): string =>
  `exists (select 1 from public.dm_threads vt where vt.id = ${threadRef} and (vt.user_a = ${viewerRef}::uuid or vt.user_b = ${viewerRef}::uuid))`;

/** Same cursor semantics as messagesNewest, in a DM thread; participants only. */
export function dmMessagesNewest(threadId: string, viewerId: string, limit: number, beforeId?: string): Query {
  const values: unknown[] = [threadId];
  let cursor = "";
  if (beforeId !== undefined) {
    values.push(beforeId);
    cursor =
      " and (m.created_at, m.id) < (select b.created_at, b.id from public.dm_messages b where b.id = $2 and b.thread_id = $1)";
  }
  values.push(limit);
  const limitRef = `$${values.length}`;
  values.push(viewerId);
  return {
    text:
      `select ${DM_MESSAGE_SELECT} ${DM_MESSAGE_FROM} where m.thread_id = $1${cursor} ` +
      `and ${dmParticipant("$1", `$${values.length}`)} order by m.created_at desc, m.id desc limit ${limitRef}`,
    values,
  };
}

/** Same polling window as messagesAfter, in a DM thread; participants only. */
export function dmMessagesAfter(threadId: string, viewerId: string, afterId: string, limit: number): Query {
  return {
    text:
      `select ${DM_MESSAGE_SELECT} ${DM_MESSAGE_FROM} where m.thread_id = $1 ` +
      "and m.created_at > (select b.created_at from public.dm_messages b where b.id = $2 and b.thread_id = $1) " +
      `- make_interval(secs => ${AFTER_OVERLAP_SECONDS}) ` +
      `and ${dmParticipant("$1", "$4")} order by m.created_at asc, m.id asc limit $3`,
    values: [threadId, afterId, limit, viewerId],
  };
}

/** Stamps the caller's read time on the thread (only if they are a participant). */
export const markDmRead = (threadId: string, profileId: string): Query => ({
  text:
    "update public.dm_threads t set " +
    "a_read_at = case when t.user_a = $2::uuid then now() else t.a_read_at end, " +
    "b_read_at = case when t.user_b = $2::uuid then now() else t.b_read_at end " +
    "where t.id = $1 and (t.user_a = $2::uuid or t.user_b = $2::uuid) returning t.id",
  values: [threadId, profileId],
});

/**
 * Posts a DM: written only if the author is a participant of the thread. The
 * same statement bumps last_message_at and marks the thread read for the author.
 * Zero rows back = not allowed.
 */
export const insertDmMessage = (threadId: string, authorId: string, content: string): Query => ({
  text:
    "with ins as (" +
    "insert into public.dm_messages (thread_id, author_id, content) " +
    "select t.id, $2::uuid, $3::text from public.dm_threads t " +
    "where t.id = $1 and (t.user_a = $2::uuid or t.user_b = $2::uuid) " +
    "returning id, thread_id, author_id, content, created_at, edited_at), " +
    "bump as (update public.dm_threads t set last_message_at = now(), " +
    "a_read_at = case when t.user_a = $2::uuid then now() else t.a_read_at end, " +
    "b_read_at = case when t.user_b = $2::uuid then now() else t.b_read_at end " +
    "where t.id = $1 and exists (select 1 from ins) returning t.id) " +
    `select m.id, m.thread_id, m.thread_id as channel_id, m.author_id, m.content, ${isoUs("m.created_at")} as created_at, ${isoUs("m.edited_at")} as edited_at, ${AUTHOR_JSON} as author ` +
    "from ins m join public.profiles a on a.id = m.author_id",
  values: [threadId, authorId, content],
});

/** The DM message (inside its thread) with the thread's participants. */
export const dmMessageAccess = (threadId: string, messageId: string): Query => ({
  text:
    "select m.id, m.author_id, t.user_a, t.user_b from public.dm_messages m " +
    "join public.dm_threads t on t.id = m.thread_id where m.id = $2 and m.thread_id = $1",
  values: [threadId, messageId],
});

/** Edits a DM message and stamps edited_at: only its author, and only inside their own thread. */
export const updateDmMessage = (threadId: string, messageId: string, authorId: string, content: string): Query => ({
  text:
    "with upd as (" +
    "update public.dm_messages m set content = $4::text, edited_at = now() from public.dm_threads t " +
    "where m.id = $2 and m.thread_id = $1 and t.id = m.thread_id and m.author_id = $3::uuid " +
    "and (t.user_a = $3::uuid or t.user_b = $3::uuid) " +
    "returning m.id, m.thread_id, m.author_id, m.content, m.created_at, m.edited_at) " +
    `select m.id, m.thread_id, m.thread_id as channel_id, m.author_id, m.content, ${isoUs("m.created_at")} as created_at, ${isoUs("m.edited_at")} as edited_at, ${AUTHOR_JSON} as author ` +
    "from upd m join public.profiles a on a.id = m.author_id",
  values: [threadId, messageId, authorId, content],
});

/** Hard-deletes a DM message: only its author, and only inside their own thread. */
export const deleteDmMessage = (threadId: string, messageId: string, profileId: string): Query => ({
  text:
    "delete from public.dm_messages m using public.dm_threads t " +
    "where m.id = $2 and m.thread_id = $1 and t.id = m.thread_id and m.author_id = $3::uuid " +
    "and (t.user_a = $3::uuid or t.user_b = $3::uuid) returning m.id",
  values: [threadId, messageId, profileId],
});

// ----------------------------------------------------------------- payments

export interface NewPayment {
  opId: string;
  txHash: string;
  fromWallet: string;
  toWallet: string;
  asset: string;
  amount: string;
  note: string | null;
  registeredBy: string;
  paidAt: string;
  /** El permiso (PIN) que respalda este pago, ya consumido; null si no hubo. */
  approvalId?: string | null;
  /** Sin permiso válido: se guarda igual (el dinero ya se movió) pero se marca. Por defecto: `!approvalId`. */
  unverified?: boolean;
}

const PARTY_JSON = (alias: string) =>
  `case when ${alias}.id is null then null else json_build_object('username', ${alias}.username, 'display_name', ${alias}.display_name, ` +
  `'avatar_seed', ${alias}.avatar_seed, 'avatar_style', ${alias}.avatar_style) end`;

/** What a payment looks like on the wire: the row plus both sides' slim profiles (null for wallets without one). */
const paymentSelect = (unverified: string) =>
  `py.id, py.tx_hash, py.from_wallet, py.to_wallet, py.asset, py.amount::text as amount, py.note, ${isoUs("py.paid_at")} as paid_at, ` +
  `${unverified} as unverified, ${PARTY_JSON("pf")} as from_profile, ${PARTY_JSON("pt")} as to_profile`;
const PAYMENT_SELECT = paymentSelect("py.unverified");
const PAYMENT_FROM =
  "from public.payments py left join public.profiles pf on pf.wallet = py.from_wallet left join public.profiles pt on pt.wallet = py.to_wallet";

/** Records a verified payment once: a second call for the same operation inserts nothing. */
export const insertPayment = (p: NewPayment): Query => ({
  text:
    "with ins as (" +
    "insert into public.payments (op_id, tx_hash, from_wallet, to_wallet, asset, amount, note, registered_by, paid_at, approval_id, unverified) " +
    "values ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9::timestamptz, $10::uuid, $11::boolean) on conflict (op_id) do nothing returning *) " +
    `select ${PAYMENT_SELECT} from ins py ` +
    "left join public.profiles pf on pf.wallet = py.from_wallet left join public.profiles pt on pt.wallet = py.to_wallet",
  values: [
    p.opId, p.txHash, p.fromWallet, p.toWallet, p.asset, p.amount, p.note, p.registeredBy, p.paidAt,
    p.approvalId ?? null,
    p.unverified ?? !p.approvalId,
  ],
});

/** An already recorded operation, only if `wallet` sent it. */
export const paymentByOpForSender = (opId: string, wallet: string): Query => ({
  text: `select ${PAYMENT_SELECT} ${PAYMENT_FROM} where py.op_id = $1 and py.from_wallet = $2`,
  values: [opId, wallet],
});

/** Payments `wallet` sent or received, newest first. */
export const paymentsOfWallet = (wallet: string, limit: number): Query => ({
  text:
    `select ${paymentSelect("(py.unverified and py.from_wallet = $1)")} ${PAYMENT_FROM} where py.from_wallet = $1 or py.to_wallet = $1 ` +
    "order by py.paid_at desc, py.id desc limit $2",
  values: [wallet, limit],
});

// ------------------------------------------------------------ payment security
//
// El PIN de pagos (migraciones 0009 y 0011). Cada paso que decide algo de
// seguridad es UN solo statement atómico (o una transacción con la fila de
// payment_security bloqueada), para que pedidos en paralelo no puedan saltarse
// el bloqueo, pasarse del límite ni usar una verificación de un PIN que ya cambió.
//
// `pin_version` sube con cada PIN nuevo (crearlo, cambiarlo, activar un reset).
// La verificación del PIN devuelve la versión con la que se hizo, y cada acción
// posterior (permiso, límites, cambio de PIN) exige que siga siendo la vigente.

/** Estado del PIN de un perfil. Sin fila = todavía no creó su PIN. `locked_until` solo si sigue vigente. */
export const securityRow = (profileId: string): Query => ({
  text:
    "select (s.pin_hash is not null) as has_pin, " +
    `${isoUs("(case when s.locked_until > now() then s.locked_until end)")} as locked_until, ` +
    `${isoUs("s.pending_pin_at")} as pending_pin_at, ` +
    "s.daily_limit_usdc::text as daily_limit_usdc, s.daily_limit_xlm::text as daily_limit_xlm " +
    "from public.payment_security s where s.profile_id = $1",
  values: [profileId],
});

/**
 * Lo aprobado en las últimas 24 h móviles, por activo: TODOS los permisos creados
 * (usados o no, vencidos o no). Un permiso que no se usó no libera cupo: no hay
 * forma de saber que el pago no va a llegar.
 */
export const approvedLast24h = (profileId: string): Query => ({
  text:
    "select a.asset, coalesce(sum(a.amount), 0)::text as spent from public.payment_approvals a " +
    "where a.profile_id = $1 and a.created_at > now() - interval '24 hours' group by a.asset",
  values: [profileId],
});

export interface LockPolicy {
  maxAttempts: number;
  baseMs: number;
  maxMs: number;
  maxLevel: number;
}

/** Bloquea la fila de seguridad de un perfil hasta el final de la transacción (serializa las verificaciones del PIN). */
export const lockSecurityForPin = (profileId: string): Query => ({
  text: "select s.profile_id from public.payment_security s where s.profile_id = $1 for update",
  values: [profileId],
});

/**
 * Si un "olvidé mi PIN" ya cumplió sus 24 h, el PIN pendiente pasa a ser el PIN
 * (versión + 1, sin fallos ni bloqueo) y los permisos pendientes vencen, todo en
 * el mismo statement. Devuelve la fila solo si activó algo.
 */
export const activatePendingPin = (profileId: string): Query => ({
  text:
    "with act as (" +
    "update public.payment_security s set pin_hash = s.pending_pin_hash, pin_salt = s.pending_pin_salt, pin_set_at = now(), " +
    "pin_version = s.pin_version + 1, failed_attempts = 0, lock_level = 0, locked_until = null, " +
    "pending_pin_hash = null, pending_pin_salt = null, pending_pin_at = null, updated_at = now() " +
    "where s.profile_id = $1 and s.pending_pin_hash is not null and s.pending_pin_at <= now() returning s.profile_id), " +
    "inv as (update public.payment_approvals set expires_at = now() " +
    "where profile_id = $1 and used_at is null and expires_at > now() and exists (select 1 from act) returning id) " +
    "select profile_id from act",
  values: [profileId],
});

/**
 * Reserva un intento ANTES de mirar el PIN: suma 1 a los fallos y, si llega al
 * máximo, bloquea (`base * 2^nivel`, con tope), sube el nivel y vuelve los fallos
 * a 0. Todo en un UPDATE, que además solo corre si NO hay bloqueo vigente. Se usa
 * dentro de la transacción de `checkPin`, con la fila ya bloqueada. Devuelve el
 * hash guardado y la versión del PIN; sin fila = sin PIN o bloqueado. Si el PIN
 * resulta correcto, `clearPinFailures` deshace la cuenta. (Misma regla que
 * pin-rules.nextFailureState.)
 */
export const reservePinAttempt = (profileId: string, policy: LockPolicy): Query => ({
  text:
    "update public.payment_security s set " +
    "failed_attempts = case when s.failed_attempts + 1 >= $2 then 0 else s.failed_attempts + 1 end, " +
    "lock_level = case when s.failed_attempts + 1 >= $2 then least(s.lock_level + 1, $5) else s.lock_level end, " +
    "locked_until = case when s.failed_attempts + 1 >= $2 then " +
    "now() + least($3::double precision * power(2, s.lock_level), $4::double precision) * interval '1 millisecond' " +
    "else s.locked_until end, updated_at = now() " +
    "where s.profile_id = $1 and s.pin_hash is not null and (s.locked_until is null or s.locked_until <= now()) " +
    "returning s.pin_hash, s.pin_salt, s.pin_version, s.failed_attempts, coalesce(s.locked_until > now(), false) as locked, " +
    `${isoUs("s.locked_until")} as locked_until`,
  values: [profileId, policy.maxAttempts, policy.baseMs, policy.maxMs, policy.maxLevel],
});

/** PIN correcto: fallos y nivel de bloqueo vuelven a 0. */
export const clearPinFailures = (profileId: string): Query => ({
  text:
    "update public.payment_security set failed_attempts = 0, lock_level = 0, locked_until = null, updated_at = now() " +
    "where profile_id = $1 and (failed_attempts <> 0 or lock_level <> 0 or locked_until is not null) returning profile_id",
  values: [profileId],
});

/** Crea el primer PIN solo si todavía no hay uno (si dos pedidos compiten, uno no devuelve fila). */
export const createPin = (profileId: string, hash: string, salt: string): Query => ({
  text:
    "insert into public.payment_security as s (profile_id, pin_hash, pin_salt, pin_set_at, pin_version, updated_at) " +
    "values ($1, $2, $3, now(), 1, now()) on conflict (profile_id) do update set " +
    "pin_hash = excluded.pin_hash, pin_salt = excluded.pin_salt, pin_set_at = now(), pin_version = s.pin_version + 1, " +
    "failed_attempts = 0, lock_level = 0, locked_until = null, " +
    "pending_pin_hash = null, pending_pin_salt = null, pending_pin_at = null, updated_at = now() " +
    "where s.pin_hash is null returning s.profile_id",
  values: [profileId, hash, salt],
});

/**
 * Cambia un PIN que ya existe (el actual ya se verificó, en la versión `expectedVersion`):
 * versión + 1, borra un reset pendiente y vence los permisos pendientes, en un solo
 * statement. Sin fila = el PIN cambió mientras tanto (o no hay PIN).
 */
export const changePin = (profileId: string, hash: string, salt: string, expectedVersion: number): Query => ({
  text:
    "with chg as (" +
    "update public.payment_security set pin_hash = $2, pin_salt = $3, pin_set_at = now(), pin_version = pin_version + 1, " +
    "failed_attempts = 0, lock_level = 0, locked_until = null, " +
    "pending_pin_hash = null, pending_pin_salt = null, pending_pin_at = null, updated_at = now() " +
    "where profile_id = $1 and pin_hash is not null and pin_version = $4 returning profile_id), " +
    "inv as (update public.payment_approvals set expires_at = now() " +
    "where profile_id = $1 and used_at is null and expires_at > now() and exists (select 1 from chg) returning id) " +
    "select profile_id from chg",
  values: [profileId, hash, salt, expectedVersion],
});

/** Dentro de la transacción de "olvidé mi PIN": ¿hay PIN?, ¿hay un reset pendiente y cuándo se activa? Bloquea la fila. */
export const securityForReset = (profileId: string): Query => ({
  text:
    "select (s.pin_hash is not null) as has_pin, (s.pending_pin_hash is not null) as has_pending, " +
    `${isoUs("s.pending_pin_at")} as pending_pin_at from public.payment_security s where s.profile_id = $1 for update`,
  values: [profileId],
});

/** Quien todavía no tenía PIN: el primero se pone al instante (versión + 1, sin bloqueo). */
export const resetPinNow = (profileId: string, hash: string, salt: string): Query => ({
  text:
    "insert into public.payment_security as s (profile_id, pin_hash, pin_salt, pin_set_at, pin_version, updated_at) " +
    "values ($1, $2, $3, now(), 1, now()) on conflict (profile_id) do update set " +
    "pin_hash = excluded.pin_hash, pin_salt = excluded.pin_salt, pin_set_at = now(), pin_version = s.pin_version + 1, " +
    "failed_attempts = 0, lock_level = 0, locked_until = null, " +
    "pending_pin_hash = null, pending_pin_salt = null, pending_pin_at = null, updated_at = now() returning s.profile_id",
  values: [profileId, hash, salt],
});

/** "Olvidé mi PIN" con PIN existente: el nuevo queda pendiente y se activa en `delayMs`. El actual sigue valiendo. */
export const setPendingPin = (profileId: string, hash: string, salt: string, delayMs: number): Query => ({
  text:
    "update public.payment_security set pending_pin_hash = $2, pending_pin_salt = $3, " +
    "pending_pin_at = now() + $4::double precision * interval '1 millisecond', updated_at = now() " +
    `where profile_id = $1 and pin_hash is not null returning ${isoUs("pending_pin_at")} as pending_pin_at`,
  values: [profileId, hash, salt, delayMs],
});

/** Cancela el reset pendiente (quien llama ya verificó el PIN actual). */
export const cancelPendingPin = (profileId: string): Query => ({
  text:
    "update public.payment_security set pending_pin_hash = null, pending_pin_salt = null, pending_pin_at = null, updated_at = now() " +
    "where profile_id = $1 and pending_pin_hash is not null returning profile_id",
  values: [profileId],
});

/** Permisos todavía vigentes y sin usar: vencen ya. (Un pago que cerró antes sigue pudiendo usarlos; ver claimApproval.) */
export const expirePendingApprovals = (profileId: string): Query => ({
  text:
    "update public.payment_approvals set expires_at = now() " +
    "where profile_id = $1 and used_at is null and expires_at > now() returning id",
  values: [profileId],
});

/**
 * Cambia uno o los dos límites diarios (null = no tocar) si el PIN sigue en la versión
 * `expectedVersion` con la que se verificó. Los valores ya vienen validados.
 */
export const setDailyLimits = (profileId: string, usdc: string | null, xlm: string | null, expectedVersion: number): Query => ({
  text:
    "update public.payment_security set daily_limit_usdc = coalesce($2::numeric, daily_limit_usdc), " +
    "daily_limit_xlm = coalesce($3::numeric, daily_limit_xlm), updated_at = now() " +
    "where profile_id = $1 and pin_hash is not null and pin_version = $4 returning profile_id",
  values: [profileId, usdc, xlm, expectedVersion],
});

/** Dentro de la transacción de `approve`: bloquea la fila de seguridad si el PIN sigue en la versión verificada. */
export const lockSecurityRow = (profileId: string, expectedVersion: number): Query => ({
  text:
    "select s.daily_limit_usdc::text as daily_limit_usdc, s.daily_limit_xlm::text as daily_limit_xlm " +
    "from public.payment_security s where s.profile_id = $1 and s.pin_hash is not null and s.pin_version = $2 for update",
  values: [profileId, expectedVersion],
});

export interface NewApproval {
  profileId: string;
  toWallet: string;
  asset: string;
  amount: string;
  ttlMs: number;
  /** La versión del PIN con la que se verificó. */
  pinVersion: number;
}

export const insertApproval = (a: NewApproval): Query => ({
  text:
    "insert into public.payment_approvals (profile_id, to_wallet, asset, amount, method, expires_at, pin_version) " +
    "values ($1, $2, $3, $4::numeric, 'pin', now() + $5::double precision * interval '1 millisecond', $6) " +
    `returning id, ${isoUs("expires_at")} as expires_at`,
  values: [a.profileId, a.toWallet, a.asset, a.amount, a.ttlMs, a.pinVersion],
});

export interface ApprovalClaim {
  approvalId: string;
  profileId: string;
  toWallet: string;
  asset: string;
  amount: string;
  paidAt: string;
  graceMs: number;
}

/**
 * Consume el permiso de un pago ya verificado en Horizon: mismo perfil, destino,
 * activo y monto exacto, sin usar, el pago cerró dentro de su vida (con holgura) y
 * el permiso es de la versión de PIN vigente o el pago cerró antes de que el PIN
 * cambiara. Una sola vez: el UPDATE solo toca filas con `used_at is null`. Misma
 * regla que pin-rules.approvalMatches.
 */
export const claimApproval = (c: ApprovalClaim): Query => ({
  text:
    "update public.payment_approvals a set used_at = now() from public.payment_security s " +
    "where s.profile_id = a.profile_id and a.id = $1::uuid and a.profile_id = $2 and a.to_wallet = $3 and a.asset = $4 " +
    "and a.amount = $5::numeric and a.used_at is null " +
    "and $6::timestamptz <= a.expires_at + $7::double precision * interval '1 millisecond' " +
    "and $6::timestamptz >= a.created_at - $7::double precision * interval '1 millisecond' " +
    "and (a.pin_version = s.pin_version or $6::timestamptz < s.pin_set_at) " +
    "returning a.id",
  values: [c.approvalId, c.profileId, c.toWallet, c.asset, c.amount, c.paidAt, c.graceMs],
});

/** Une el permiso consumido con el pago guardado. */
export const linkApproval = (approvalId: string, paymentId: string): Query => ({
  text: "update public.payment_approvals set payment_id = $2 where id = $1 and payment_id is null returning id",
  values: [approvalId, paymentId],
});

// ----------------------------------------------------------------- vaquitas
//
// Vaquita (migración 0010). Lo recaudado y los aportantes se calculan sumando
// vaquita_contributions; no hay columnas que mantener.

export interface NewVaquita {
  communityId: string;
  creatorId: string;
  title: string;
  description: string | null;
  /** Decimal con 7 lugares. */
  goalUsdc: string;
  /** ISO o null. */
  deadline: string | null;
}

/** Una vaquita tal como viaja: la fila, quién la creó (slim + wallet de cobro) y lo recaudado. */
const VAQUITA_SELECT =
  `v.id, v.community_id, v.title, v.description, v.goal_usdc::text as goal_usdc, agg.raised::text as raised_usdc, agg.contributors as contributors_count, ` +
  `${isoUs("v.deadline")} as deadline, v.status, ${isoUs("v.created_at")} as created_at, ${isoUs("v.closed_at")} as closed_at, ` +
  `a.wallet as creator_wallet, ${AUTHOR_JSON} as creator`;
const VAQUITA_FROM =
  "from public.vaquitas v join public.profiles a on a.id = v.creator_id " +
  "left join lateral (select coalesce(sum(c.amount_usdc), 0) as raised, count(distinct c.contributor_id)::int as contributors " +
  "from public.vaquita_contributions c where c.vaquita_id = v.id) agg on true";

/** Crea la vaquita solo si quien la crea es miembro de la comunidad (si no, cero filas). */
export const insertVaquita = (v: NewVaquita): Query => ({
  text:
    "insert into public.vaquitas (community_id, creator_id, title, description, goal_usdc, deadline) " +
    "select $1::uuid, $2::uuid, $3, $4, $5::numeric, $6::timestamptz " +
    "where exists (select 1 from public.members m where m.community_id = $1::uuid and m.profile_id = $2::uuid) " +
    "returning id",
  values: [v.communityId, v.creatorId, v.title, v.description, v.goalUsdc, v.deadline],
});

export const vaquitaById = (id: string): Query => ({
  text: `select ${VAQUITA_SELECT} ${VAQUITA_FROM} where v.id = $1`,
  values: [id],
});

/** Abiertas primero (las nuevas arriba), luego las cerradas, las que cerraron hace poco arriba. */
export const listVaquitas = (communityId: string, limit: number): Query => ({
  text:
    `select ${VAQUITA_SELECT} ${VAQUITA_FROM} where v.community_id = $1 ` +
    "order by (v.status = 'open') desc, coalesce(v.closed_at, v.created_at) desc, v.id desc limit $2",
  values: [communityId, limit],
});

/** Lo que hace falta para decidir sobre una vaquita: la fila, la wallet de cobro y el rol de quien pregunta. */
export const vaquitaWithRole = (id: string, profileId: string): Query => ({
  text:
    `select v.id, v.community_id, v.creator_id, v.status, ${isoUs("v.deadline")} as deadline, ${isoUs("v.created_at")} as created_at, ` +
    "a.wallet as creator_wallet, m.role " +
    "from public.vaquitas v join public.profiles a on a.id = v.creator_id " +
    "left join public.members m on m.community_id = v.community_id and m.profile_id = $2 " +
    "where v.id = $1",
  values: [id, profileId],
});

/** Los aportes de una vaquita, el más reciente primero. La fecha es la del pago. */
export const listVaquitaContributions = (vaquitaId: string, limit: number): Query => ({
  text:
    `select c.id, c.amount_usdc::text as amount_usdc, py.tx_hash, ${isoUs("py.paid_at")} as created_at, ` +
    `json_build_object('id', a.id, 'username', a.username, 'display_name', a.display_name, 'avatar_seed', a.avatar_seed, 'avatar_style', a.avatar_style) as contributor ` +
    "from public.vaquita_contributions c join public.payments py on py.id = c.payment_id join public.profiles a on a.id = c.contributor_id " +
    "where c.vaquita_id = $1 order by py.paid_at desc, c.id desc limit $2",
  values: [vaquitaId, limit],
});

/** Un pago tal como lo guardó el servidor, para decidir si cuenta como aporte. */
export const paymentForVaquita = (paymentId: string): Query => ({
  text:
    `select py.id, py.from_wallet, py.to_wallet, py.asset, py.unverified, ${isoUs("py.paid_at")} as paid_at, ` +
    "exists (select 1 from public.vaquita_contributions c where c.payment_id = py.id) as linked " +
    "from public.payments py where py.id = $1",
  values: [paymentId],
});

/**
 * Vincula el pago como aporte. Las reglas se aplican otra vez aquí, con los datos
 * de la base: vaquita abierta y sin vencer, pago en USDC enviado por `fromWallet`
 * (la de la sesión) a la wallet de quien creó la vaquita, con PIN, posterior a la
 * vaquita. El contribuyente y el monto salen del pago. Un pago ya vinculado
 * choca con el índice único (23505).
 */
export const insertVaquitaContribution = (vaquitaId: string, paymentId: string, profileId: string, fromWallet: string): Query => ({
  text:
    "insert into public.vaquita_contributions (vaquita_id, payment_id, contributor_id, amount_usdc) " +
    "select v.id, py.id, $3::uuid, py.amount " +
    "from public.vaquitas v join public.profiles cr on cr.id = v.creator_id, public.payments py " +
    "where v.id = $1 and py.id = $2 and v.status = 'open' and (v.deadline is null or v.deadline > now()) " +
    "and v.creator_id <> $3::uuid and py.asset = 'USDC' and py.from_wallet = $4 and py.to_wallet = cr.wallet " +
    "and not py.unverified and py.paid_at >= v.created_at " +
    "and exists (select 1 from public.members m where m.community_id = v.community_id and m.profile_id = $3::uuid) " +
    "returning id",
  values: [vaquitaId, paymentId, profileId, fromWallet],
});

/** Cierra la vaquita (quien la creó u owner/admin). Cero filas si ya estaba cerrada o no hay permiso. */
export const closeVaquita = (id: string, profileId: string): Query => ({
  text:
    "update public.vaquitas v set status = 'closed', closed_at = now() " +
    "where v.id = $1 and v.status = 'open' and (v.creator_id = $2 or exists (" +
    "select 1 from public.members m where m.community_id = v.community_id and m.profile_id = $2 and m.role in ('owner', 'admin'))) " +
    "returning v.id",
  values: [id, profileId],
});

/**
 * Métricas de uso (sin parámetros): vaquitas creadas y abiertas, quiénes las
 * crean, aportes, aportantes, USDC aportado y vaquitas completadas (recaudado >= meta).
 */
export const vaquitaStats = (): Query => ({
  text:
    "select " +
    "(select count(*) from public.vaquitas)::int as created, " +
    "(select count(*) from public.vaquitas where status = 'open')::int as open, " +
    "(select count(distinct creator_id) from public.vaquitas)::int as creators, " +
    "(select count(*) from public.vaquita_contributions)::int as contributions, " +
    "(select count(distinct contributor_id) from public.vaquita_contributions)::int as contributors, " +
    "(select coalesce(sum(amount_usdc), 0) from public.vaquita_contributions)::text as raised_usdc, " +
    "(select count(*) from public.vaquitas v where (select coalesce(sum(c.amount_usdc), 0) from public.vaquita_contributions c where c.vaquita_id = v.id) >= v.goal_usdc)::int as completed",
  values: [],
});

// --------------------------------------------------------------- migrations

export const SCHEMA_TABLES = [
  "profiles",
  "communities",
  "members",
  "channels",
  "messages",
  "payments",
  "payment_security",
  "payment_approvals",
  "vaquitas",
  "vaquita_contributions",
] as const;
