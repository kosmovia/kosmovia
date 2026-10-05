/** Authorization decisions (pure) and request validation of the api backend. */
import assert from "node:assert/strict";
import test from "node:test";

import { parseBackend, serverBackend } from "../lib/core/backend.ts";
import {
  canCreateChannel,
  canPostInChannel,
  canReadCommunity,
  isAdminRole,
  isChannelType,
  roleOf,
  type ChannelType,
  type Role,
} from "../lib/core/authz.ts";
import {
  cleanSlugParam,
  cleanUsernameParam,
  parseChannelCreate,
  parseCommunityCreate,
  parseMessageCreate,
  parseMessagesQuery,
  parseProfileCreate,
  parseProfileUpdate,
} from "../lib/core/api-input.ts";

const ROLES: Role[] = [null, "member", "admin", "owner"];
const TYPES: ChannelType[] = ["text", "announcement"];

test("reading a community's channels, members and messages is for members only", () => {
  assert.equal(canReadCommunity(null).allowed, false);
  for (const r of ["member", "admin", "owner"] as const) assert.equal(canReadCommunity(r).allowed, true);
  const denied = canReadCommunity(null);
  assert.ok(!denied.allowed && denied.status === 403 && denied.code === "not_member");
});

test("posting: members write in text channels, only owner/admin in announcement ones, outsiders nowhere", () => {
  const expected: Record<string, boolean> = {
    "null/text": false,
    "null/announcement": false,
    "member/text": true,
    "member/announcement": false,
    "admin/text": true,
    "admin/announcement": true,
    "owner/text": true,
    "owner/announcement": true,
  };
  for (const role of ROLES) {
    for (const type of TYPES) {
      assert.equal(canPostInChannel(role, type).allowed, expected[`${role}/${type}`], `${role}/${type}`);
    }
  }
  const d = canPostInChannel("member", "announcement");
  assert.ok(!d.allowed && d.code === "announcement_readonly" && d.status === 403);
  const out = canPostInChannel(null, "text");
  assert.ok(!out.allowed && out.code === "not_member");
});

test("creating channels is for owner and admin", () => {
  assert.equal(canCreateChannel("owner").allowed, true);
  assert.equal(canCreateChannel("admin").allowed, true);
  const member = canCreateChannel("member");
  assert.ok(!member.allowed && member.code === "not_admin");
  const none = canCreateChannel(null);
  assert.ok(!none.allowed && none.code === "not_member");
});

test("role and channel-type helpers refuse anything unknown", () => {
  assert.equal(isAdminRole("owner") && isAdminRole("admin"), true);
  assert.equal(isAdminRole("member") || isAdminRole(null), false);
  assert.equal(roleOf("owner"), "owner");
  for (const junk of ["superadmin", "", null, undefined, "OWNER"]) assert.equal(roleOf(junk), null);
  assert.equal(isChannelType("text") && isChannelType("announcement"), true);
  for (const junk of ["voice", "", null, undefined, 1, {}]) assert.equal(isChannelType(junk), false);
});

test("backend switch: only the exact value api turns it on, supabase is the default", () => {
  assert.equal(parseBackend("api"), "api");
  assert.equal(parseBackend(" API "), "api");
  for (const other of [undefined, null, "", "supabase", "postgres", "apis", "true"]) {
    assert.equal(parseBackend(other as string | undefined), "supabase", String(other));
  }
  assert.equal(serverBackend({}), "supabase");
  assert.equal(serverBackend({ KOSMOVIA_DATA_BACKEND: "api" }), "api");
  // The public variable alone does not switch the server routes on.
  assert.equal(serverBackend({ NEXT_PUBLIC_KOSMOVIA_DATA_BACKEND: "api" }), "supabase");
});

test("profile create: username and avatar are validated, id and wallet are not accepted from the body", () => {
  const ok = parseProfileCreate({ username: "@Prueba_Kosmo", displayName: "  Prueba  ", avatarSeed: "G1234:abc", avatarStyle: "planet" });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.value, { username: "prueba_kosmo", displayName: "Prueba", avatarSeed: "G1234:abc", avatarStyle: "planet" });
  }
  // Extra fields are simply not part of the result.
  const extra = parseProfileCreate({ username: "abc", id: "x", wallet: "G", trust_level: 2, x_handle: "e" });
  assert.ok(extra.ok);
  if (extra.ok) assert.deepEqual(Object.keys(extra.value).sort(), ["avatarSeed", "avatarStyle", "displayName", "username"]);

  for (const bad of [
    null,
    "x",
    {},
    { username: 5 },
    { username: "ab" },
    { username: "con espacio" },
    { username: "abc", displayName: "x".repeat(41) },
    { username: "abc", displayName: 7 },
    { username: "abc", avatarSeed: "bad seed!" },
    { username: "abc", avatarSeed: "a".repeat(65) },
    { username: "abc", avatarStyle: "<script>" },
  ]) {
    assert.equal(parseProfileCreate(bad).ok, false, JSON.stringify(bad));
  }
});

test("profile update: only the five editable fields, at least one, validated", () => {
  const ok = parseProfileUpdate({ bio: " hola ", trust_level: 2, x_handle: "evil", wallet: "G" });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.value, { bio: "hola" });
  assert.equal(parseProfileUpdate({}).ok, false);
  assert.equal(parseProfileUpdate({ trust_level: 2 }).ok, false);
  assert.equal(parseProfileUpdate({ bio: "x".repeat(281) }).ok, false);
  assert.equal(parseProfileUpdate({ username: "A B" }).ok, false);
  assert.equal(parseProfileUpdate({ avatarStyle: "nope" }).ok, false);
  const all = parseProfileUpdate({ username: "@nuevo", displayName: "N", avatarSeed: "s1", avatarStyle: "rocket", bio: "b" });
  assert.ok(all.ok);
});

test("community create: same rules as the form and the CHECKs", () => {
  const ok = parseCommunityCreate({ name: " Prueba Kosmovia ", slug: "prueba-kosmovia", description: "d", icon: "" });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.value, { name: "Prueba Kosmovia", slug: "prueba-kosmovia", description: "d", icon: "", image: null });
  for (const bad of [
    null,
    {},
    { name: "x", slug: "abc" },
    { name: "Ok", slug: "Bad Slug" },
    { name: "Ok", slug: "ab" },
    { name: "Ok", slug: "ok-slug", description: "x".repeat(281) },
    { name: "Ok", slug: "ok-slug", icon: "x".repeat(17) },
    { name: "Ok", slug: "ok-slug", description: 5 },
    { name: "n".repeat(51), slug: "ok-slug" },
    { name: "Ok", slug: "ok-slug", image: "data:image/svg+xml;base64,PHN2Zy8+" },
  ]) {
    assert.equal(parseCommunityCreate(bad).ok, false, JSON.stringify(bad));
  }
});

test("channel create: name format, topic length, only known types", () => {
  const ok = parseChannelCreate({ name: "ideas-2", topic: " tema ", type: "announcement" });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.value, { name: "ideas-2", topic: "tema", type: "announcement", emoji: null, categoryId: null, visibility: "public" });
  const def = parseChannelCreate({ name: "general-2" });
  assert.ok(def.ok);
  if (def.ok) assert.deepEqual(def.value, { name: "general-2", topic: null, type: "text", emoji: null, categoryId: null, visibility: "public" });
  for (const bad of [
    {},
    { name: "Mayus" },
    { name: "con espacio" },
    { name: "a".repeat(31) },
    { name: "ok", type: "voice" },
    { name: "ok", topic: "x".repeat(201) },
    null,
  ]) {
    assert.equal(parseChannelCreate(bad).ok, false, JSON.stringify(bad));
  }
});

test("message create: trimmed, 1..2000, and nothing but content is read", () => {
  const ok = parseMessageCreate({ content: "  hola  ", author_id: "someone-else", channel_id: "x" });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.value, { content: "hola" });
  for (const bad of [null, {}, { content: "" }, { content: "   " }, { content: "x".repeat(2001) }, { content: 5 }]) {
    assert.equal(parseMessageCreate(bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(parseMessageCreate({ content: "x".repeat(2000) }).ok, true);
});

test("messages query: cursors are uuids, one cursor at a time, limit is digits", () => {
  const id = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
  const parse = (qs: string) => parseMessagesQuery(new URLSearchParams(qs));
  assert.deepEqual(parse(""), { ok: true, value: {} });
  assert.deepEqual(parse(`before=${id}&limit=25`), { ok: true, value: { before: id, limit: 25 } });
  assert.deepEqual(parse(`after=${id}`), { ok: true, value: { after: id } });
  for (const bad of [
    `before=${id}&after=${id}`,
    "before=1",
    "before=' or 1=1 --",
    "after=2026-10-02T00:00:00Z",
    "limit=-1",
    "limit=abc",
    "limit=10000000",
    "limit=1.5",
  ]) {
    assert.equal(parse(bad).ok, false, bad);
  }
});

test("URL segments: slugs and usernames are normalized or refused", () => {
  assert.equal(cleanSlugParam("Prueba-Kosmovia"), "prueba-kosmovia");
  for (const bad of ["ab", "a b", "../etc", "x".repeat(41), "-start", ""]) assert.equal(cleanSlugParam(bad), null, bad);
  assert.equal(cleanUsernameParam("%40Prueba_Kosmo"), "prueba_kosmo");
  assert.equal(cleanUsernameParam("abc"), "abc");
  for (const bad of ["ab", "%E0%A4%A", "a b", "x".repeat(21), "ñandu"]) assert.equal(cleanUsernameParam(bad), null, bad);
});
