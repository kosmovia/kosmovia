/** Validators, row mappers and the token store: pure, no network. */
import assert from "node:assert/strict";
import test from "node:test";

import {
  asRole,
  AUTHOR_COLUMNS,
  capMessages,
  fromHandle,
  isUniqueViolation,
  mapAuthor,
  mapChannel,
  mapCommunity,
  mapMessage,
  mapProfile,
  MAX_LOADED_HISTORY,
  MAX_WINDOW,
  mergeMessages,
  MESSAGE_COLUMNS,
  olderThanFilter,
  PAGE_SIZE,
  quotaMessage,
  toHandle,
} from "../lib/core/mappers.ts";
import { createTokenStore, REFRESH_MARGIN_MS, type StoredSession } from "../lib/core/token-store.ts";
import {
  cleanMessage,
  communityNameError,
  slugError,
  slugify,
  USERNAME_RE,
  usernameError,
} from "../lib/core/validation.ts";

test("username rules match the database CHECK", () => {
  for (const ok of ["abc", "a_b_c", "user123", "a".repeat(20)]) {
    assert.match(ok, USERNAME_RE);
    assert.equal(usernameError(ok), null);
  }
  for (const bad of ["ab", "a".repeat(21), "Upper", "con espacio", "ñandu", "a-b", "@abc"]) {
    assert.doesNotMatch(bad, USERNAME_RE);
    assert.notEqual(usernameError(bad), null);
  }
});

test("slugify strips accents and symbols, and its output validates", () => {
  assert.equal(slugify("Mi Comunidad Ñandú!"), "mi-comunidad-nandu");
  assert.equal(slugify("  --Hola   Mundo-- "), "hola-mundo");
  assert.equal(slugify("a".repeat(60)).length, 40);
  assert.equal(slugError(slugify("Stellar Bolivia")), null);
});

test("slug and name validation", () => {
  assert.equal(slugError("kosmovia"), null);
  assert.equal(slugError("ab"), "El enlace debe tener al menos 3 caracteres.");
  for (const bad of ["Upper", "-start", "end-", "dos--guiones", "con espacio", ""]) {
    assert.notEqual(slugError(bad), null, bad);
  }
  assert.equal(communityNameError("Ko"), null);
  assert.notEqual(communityNameError(" a "), null);
  assert.notEqual(communityNameError("x".repeat(51)), null);
});

test("cleanMessage trims and enforces 1..2000", () => {
  assert.equal(cleanMessage("  hola  "), "hola");
  assert.equal(cleanMessage("   "), null);
  assert.equal(cleanMessage("x".repeat(2000)), "x".repeat(2000));
  assert.equal(cleanMessage("x".repeat(2001)), null);
});

const profileRow = {
  id: "11111111-1111-5111-8111-111111111111",
  wallet: "GDEMO",
  username: "victor",
  display_name: "Victor",
  avatar_seed: "seed-1",
  avatar_style: "rocket",
  bio: null,
  trust_level: 1,
  x_handle: "victor_x",
};

test("mapProfile gives camelCase fields and an @handle", () => {
  const u = mapProfile(profileRow);
  assert.equal(u.username, "@victor");
  assert.equal(u.displayName, "Victor");
  assert.equal(u.avatarSeed, "seed-1");
  assert.equal(u.avatarStyle, "rocket");
  assert.equal(u.trustLevel, 1);
  assert.equal(u.xHandle, "victor_x");
  assert.equal(u.bio, undefined);
  assert.equal(mapProfile({ ...profileRow, display_name: "", trust_level: 7 }).displayName, "victor");
  assert.equal(mapProfile({ ...profileRow, trust_level: 7 }).trustLevel, 0);
});

test("handle helpers", () => {
  assert.equal(toHandle("ana"), "@ana");
  assert.equal(toHandle("@ana"), "@ana");
  assert.equal(fromHandle(" @Ana "), "ana");
});

test("mapChannel, mapCommunity and mapMessage", () => {
  const ch = mapChannel({ id: "c1", community_id: "k1", name: "anuncios", topic: null, type: "announcement" });
  assert.deepEqual(ch, { id: "c1", communityId: "k1", name: "anuncios", topic: undefined, type: "announcement" });
  assert.equal(mapChannel({ id: "c2", community_id: "k1", name: "x", topic: "t", type: "weird" }).type, "text");

  const com = mapCommunity({ id: "k1", slug: "kos", name: "Kos", icon: null, description: null, owner_id: "o" }, [ch]);
  assert.equal(com.icon, "");
  assert.equal(com.description, "");
  assert.equal(com.channels.length, 1);
  assert.deepEqual(com.members, []);

  const msg = mapMessage(
    { id: "m1", channel_id: "c1", author_id: profileRow.id, content: "hola", created_at: "2026-10-01T10:00:00Z" },
    mapProfile(profileRow),
  );
  assert.equal(msg.channelId, "c1");
  assert.equal(msg.author.username, "@victor");
  assert.equal(msg.createdAt, "2026-10-01T10:00:00Z");
});

test("mergeMessages dedupes by id and orders by time", () => {
  const author = mapProfile(profileRow);
  const m = (id: string, createdAt: string) => ({ id, channelId: "c", author, content: id, createdAt });
  const a = m("a", "2026-10-01T10:00:00Z");
  const b = m("b", "2026-10-01T10:00:05Z");
  const c = m("c", "2026-10-01T10:00:09Z");
  const merged = mergeMessages([b, a], [c, b, a]);
  assert.deepEqual(merged.map((x) => x.id), ["a", "b", "c"]);
});

test("asRole and isUniqueViolation", () => {
  assert.equal(asRole("owner"), "owner");
  assert.equal(asRole("root"), null);
  assert.equal(asRole(undefined), null);
  assert.equal(isUniqueViolation({ code: "23505" }), true);
  assert.equal(isUniqueViolation({ code: "23503" }), false);
  assert.equal(isUniqueViolation(null), false);
});

test("token store refreshes when less than 5 minutes are left", async () => {
  let now = 1_000_000;
  const store = createTokenStore(() => now);
  const session = (token: string, expiresAt: number): StoredSession => ({
    address: "GDEMO",
    profileId: "p",
    token,
    expiresAt,
  });
  assert.equal(await store.getToken(), null);

  let calls = 0;
  store.setRefresher(async () => {
    calls++;
    return session("fresh", now + 3_600_000);
  });
  store.set(session("old", now + 60 * 60 * 1000));
  assert.equal(await store.getToken(), "old");
  assert.equal(calls, 0);

  now += 60 * 60 * 1000 - REFRESH_MARGIN_MS + 1000; // under the margin
  const [t1, t2] = await Promise.all([store.getToken(), store.getToken()]);
  assert.equal(t1, "fresh");
  assert.equal(t2, "fresh");
  assert.equal(calls, 1, "concurrent callers share one refresh");
  assert.equal(store.getSnapshot().status, "ready");
});

test("token store: a failed refresh near expiry yields no token; expired never returns one", async () => {
  let now = 0;
  const store = createTokenStore(() => now);
  store.setRefresher(async () => null);
  store.set({ address: "G", profileId: "p", token: "t", expiresAt: 10 * 60 * 1000 });
  now = 6 * 60 * 1000; // inside margin, refresh fails, still valid
  assert.equal(await store.getToken(), "t");
  now = 11 * 60 * 1000;
  assert.equal(await store.getToken(), null);
  store.clear();
  assert.equal(store.getSnapshot().status, "idle");
});

// ---------- Endurecimiento: ventana de mensajes, paginación, autores ----------

const mkMessage = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  channelId: "c",
  author: mapProfile(profileRow),
  content: String(n),
  createdAt: `2026-10-01T10:${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}Z`,
});

test("capMessages keeps the newest MAX_WINDOW messages, oldest first", () => {
  assert.equal(MAX_WINDOW, 200);
  const all = Array.from({ length: 260 }, (_, i) => mkMessage(i));
  const capped = capMessages(mergeMessages([], all));
  assert.equal(capped.length, 200);
  assert.equal(capped[0].content, "60");
  assert.equal(capped[199].content, "259");
  // Under the cap nothing changes (same array).
  const few = mergeMessages([], all.slice(0, 5));
  assert.equal(capMessages(few), few);
  assert.equal(capMessages(all, 10).length, 10);
});

test("a live insert at the cap pushes out the oldest, a page of history grows the cap", () => {
  let list = capMessages(mergeMessages([], Array.from({ length: 200 }, (_, i) => mkMessage(100 + i))), MAX_WINDOW);
  list = capMessages(mergeMessages(list, [mkMessage(300)]), MAX_WINDOW);
  assert.equal(list.length, 200);
  assert.equal(list[0].content, "101");
  assert.equal(list[199].content, "300");
  // "Cargar anteriores": the cap grows by a page so the loaded page stays.
  const older = Array.from({ length: PAGE_SIZE }, (_, i) => mkMessage(50 + i));
  list = capMessages(mergeMessages(list, older), MAX_WINDOW + PAGE_SIZE);
  assert.equal(list.length, 250);
  assert.equal(list[0].content, "50");
  assert.ok(MAX_LOADED_HISTORY >= MAX_WINDOW + PAGE_SIZE);
});

test("olderThanFilter builds a keyset filter and refuses anything that is not timestamp + uuid", () => {
  const cursor = { createdAt: "2026-10-01T10:00:09.123456+00:00", id: "0b1c2d3e-0000-4000-8000-123456789abc" };
  assert.equal(
    olderThanFilter(cursor),
    'created_at.lt."2026-10-01T10:00:09.123456+00:00",and(created_at.eq."2026-10-01T10:00:09.123456+00:00",id.lt.0b1c2d3e-0000-4000-8000-123456789abc)',
  );
  assert.ok(olderThanFilter({ createdAt: "2026-10-01T10:00:09Z", id: cursor.id }));
  for (const bad of [
    { createdAt: 'x"),or(id.gt.0', id: cursor.id },
    { createdAt: cursor.createdAt, id: "1),or(id.gt.0" },
    { createdAt: "", id: cursor.id },
    { createdAt: cursor.createdAt, id: "not-a-uuid" },
  ]) {
    assert.equal(olderThanFilter(bad), null);
  }
});

test("mapAuthor maps only the slim author columns", () => {
  const a = mapAuthor({ id: "p1", username: "ana", display_name: "", avatar_seed: "s", avatar_style: "rocket" });
  assert.deepEqual(a, {
    id: "p1",
    username: "@ana",
    displayName: "ana",
    wallet: "",
    avatarSeed: "s",
    avatarStyle: "rocket",
  });
  assert.equal(AUTHOR_COLUMNS, "id,username,display_name,avatar_seed,avatar_style");
  assert.ok(!MESSAGE_COLUMNS.includes("*") && !AUTHOR_COLUMNS.includes("*"));
});

test("quotaMessage recognises the quota triggers of 0002_hardening.sql", () => {
  assert.match(quotaMessage({ message: "quota_exceeded:messages_per_minute" }) ?? "", /muy rápido/);
  assert.match(quotaMessage({ message: "quota_exceeded:communities_per_day" }) ?? "", /3 comunidades/);
  assert.match(quotaMessage({ message: "quota_exceeded:communities_total" }) ?? "", /10 comunidades/);
  assert.match(quotaMessage({ message: "quota_exceeded:channels_per_community" }) ?? "", /50 canales/);
  assert.match(quotaMessage({ message: "quota_exceeded:something_new" }) ?? "", /límite/);
  assert.equal(quotaMessage({ message: "new row violates row-level security policy" }), null);
  assert.equal(quotaMessage(null), null);
});
