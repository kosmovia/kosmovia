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
const COMMUNITY_COLUMNS = "c.id, c.slug, c.name, c.icon, c.description, c.owner_id, c.created_at";
const CHANNEL_COLUMNS = "ch.id, ch.community_id, ch.name, ch.topic, ch.type";

/** ISO-8601 with microseconds, so ordering by the string equals ordering by the column. */
const ISO_US = `to_char(%s at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const isoUs = (column: string): string => ISO_US.replace("%s", column);

const AUTHOR_JSON =
  "json_build_object('id', a.id, 'username', a.username, 'display_name', a.display_name, 'avatar_seed', a.avatar_seed, 'avatar_style', a.avatar_style)";

/** What a message row looks like on the wire: MessageRow + the slim author. */
const MESSAGE_SELECT = `m.id, m.channel_id, m.author_id, m.content, ${isoUs("m.created_at")} as created_at, ${AUTHOR_JSON} as author`;

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
}

/** The AFTER INSERT trigger adds the owner as a member and creates #general and #anuncios. */
export const insertCommunity = (c: NewCommunity): Query => ({
  text:
    "insert into public.communities (name, slug, description, icon, owner_id) values ($1, $2, $3, $4, $5) " +
    "returning id, slug, name, icon, description, owner_id, created_at",
  values: [c.name, c.slug, c.description, c.icon, c.ownerId],
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

// ----------------------------------------------------------------- channels

export const listChannels = (communityId: string): Query => ({
  text: `select ${CHANNEL_COLUMNS} from public.channels ch where ch.community_id = $1 order by ch.created_at asc, ch.id asc`,
  values: [communityId],
});

export interface NewChannel {
  communityId: string;
  name: string;
  topic: string | null;
  type: "text" | "announcement";
}

export const insertChannel = (c: NewChannel): Query => ({
  text:
    "insert into public.channels (community_id, name, topic, type) values ($1, $2, $3, $4) " +
    "returning id, community_id, name, topic, type",
  values: [c.communityId, c.name, c.topic, c.type],
});

/** The channel plus the caller's role in its community (null when not a member), in one round trip. */
export const channelWithRole = (channelId: string, profileId: string): Query => ({
  text:
    "select ch.id, ch.community_id, ch.type, m.role " +
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
export function messagesNewest(channelId: string, limit: number, beforeId?: string): Query {
  const values: unknown[] = [channelId];
  let cursor = "";
  if (beforeId !== undefined) {
    values.push(beforeId);
    cursor =
      " and (m.created_at, m.id) < (select b.created_at, b.id from public.messages b where b.id = $2 and b.channel_id = $1)";
  }
  values.push(limit);
  return {
    text:
      `select ${MESSAGE_SELECT} ${MESSAGE_FROM} where m.channel_id = $1${cursor} ` +
      `order by m.created_at desc, m.id desc limit $${values.length}`,
    values,
  };
}

/** Seconds of overlap of the polling query (see messagesAfter). */
export const AFTER_OVERLAP_SECONDS = 5;

/**
 * Messages after `afterId`, oldest first, for polling. A message's created_at
 * is the START of its transaction, so one that commits late can carry a
 * timestamp older than a message the client already has. The window therefore
 * reaches back AFTER_OVERLAP_SECONDS before the cursor; the client dedupes by id.
 */
export function messagesAfter(channelId: string, afterId: string, limit: number): Query {
  return {
    text:
      `select ${MESSAGE_SELECT} ${MESSAGE_FROM} where m.channel_id = $1 ` +
      "and m.created_at > (select b.created_at from public.messages b where b.id = $2 and b.channel_id = $1) " +
      `- make_interval(secs => ${AFTER_OVERLAP_SECONDS}) ` +
      "order by m.created_at asc, m.id asc limit $3",
    values: [channelId, afterId, limit],
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
    "where ch.id = $1 and (ch.type = 'text' or mem.role in ('owner', 'admin')) " +
    "returning id, channel_id, author_id, content, created_at) " +
    `select m.id, m.channel_id, m.author_id, m.content, ${isoUs("m.created_at")} as created_at, ${AUTHOR_JSON} as author ` +
    "from ins m join public.profiles a on a.id = m.author_id",
  values: [channelId, authorId, content],
});

// --------------------------------------------------------------- migrations

export const SCHEMA_TABLES = ["profiles", "communities", "members", "channels", "messages"] as const;
