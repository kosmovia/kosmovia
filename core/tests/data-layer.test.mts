/** Validators, row mappers and the token store: pure, no network. */
import assert from "node:assert/strict";
import test from "node:test";

import {
  asRole,
  fromHandle,
  isUniqueViolation,
  mapChannel,
  mapCommunity,
  mapMessage,
  mapProfile,
  mergeMessages,
  toHandle,
} from "../lib/mappers.ts";
import { createTokenStore, REFRESH_MARGIN_MS, type StoredSession } from "../lib/token-store.ts";
import {
  cleanMessage,
  communityNameError,
  slugError,
  slugify,
  USERNAME_RE,
  usernameError,
} from "../lib/validation.ts";

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
