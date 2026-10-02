import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-ignore: Node necesita la extensión .ts al importar; Next la resuelve sin ella.
import { PREFIJOS, ROLES, sugerirUsernames, usernameAleatorio } from "../lib/usernames.ts";
// @ts-ignore
import { AVATAR_COOLDOWN_MS, USERNAME_COOLDOWN_MS, cooldownMessage, proximoCambio } from "../lib/cooldowns.ts";
// @ts-ignore
import { classifyDbError } from "../lib/db/errors.ts";
// @ts-ignore
import { USERNAME_RE } from "../lib/validation.ts";
// @ts-ignore
import * as q from "../lib/db/sql.ts";
// @ts-ignore
import { azarFijo } from "../lib/avatar/kosmonautas.ts";

test("todo @usuario sugerido cumple el formato y es temático", () => {
  const rnd = azarFijo(5);
  for (let i = 0; i < 2000; i++) {
    const u = usernameAleatorio(rnd);
    assert.match(u, USERNAME_RE, u);
    assert.ok(PREFIJOS.some((p: string) => u.includes(p)), u);
    assert.ok(ROLES.some((r: string) => u.includes(r)), u);
  }
});

test("las sugerencias son distintas y evitan las ocupadas", () => {
  const rnd = azarFijo(11);
  const first = sugerirUsernames(6, rnd);
  assert.equal(first.length, 6);
  assert.equal(new Set(first).size, 6);
  const again = sugerirUsernames(6, azarFijo(11), new Set(first));
  for (const u of again) assert.ok(!first.includes(u), u);
});

test("proximoCambio: 24 h para el @usuario y 3 días para el avatar", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  assert.equal(proximoCambio(undefined, USERNAME_COOLDOWN_MS, now), null);
  assert.equal(proximoCambio("basura", USERNAME_COOLDOWN_MS, now), null);
  assert.equal(proximoCambio("2026-10-01T11:59:00Z", USERNAME_COOLDOWN_MS, now), null);
  assert.equal(proximoCambio("2026-10-02T10:00:00Z", USERNAME_COOLDOWN_MS, now)?.toISOString(), "2026-10-03T10:00:00.000Z");
  assert.equal(proximoCambio("2026-09-30T12:00:00Z", AVATAR_COOLDOWN_MS, now)?.toISOString(), "2026-10-03T12:00:00.000Z");
  assert.equal(proximoCambio("2026-09-29T11:00:00Z", AVATAR_COOLDOWN_MS, now), null);
});

test("el error del trigger llega como 429 cooldown en español", () => {
  const u = classifyDbError({ code: "P0001", message: "cooldown:username" });
  assert.equal(u.status, 429);
  assert.equal(u.code, "cooldown");
  assert.match(u.error, /24 horas/);
  assert.match(classifyDbError({ code: "P0001", message: "cooldown:avatar" }).error, /3 días/);
  assert.equal(cooldownMessage({ message: "otra cosa" }), null);
});

for (const file of ["../db/migrations/0003_cambios_perfil.sql", "../supabase/migrations/0004_cambios_perfil.sql"]) {
  test(`${file}: trigger con 24 h y 3 días, y fechas que el cliente no puede fijar`, () => {
    const sql = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(sql, /add column if not exists username_changed_at timestamptz/);
    assert.match(sql, /add column if not exists avatar_changed_at timestamptz/);
    assert.match(sql, /interval '24 hours'/);
    assert.match(sql, /interval '3 days'/);
    assert.match(sql, /raise exception 'cooldown:username'/);
    assert.match(sql, /raise exception 'cooldown:avatar'/);
    assert.match(sql, /new\.username_changed_at := old\.username_changed_at/);
    assert.match(sql, /new\.avatar_changed_at := old\.avatar_changed_at/);
    assert.match(sql, /before update on public\.profiles/);
    assert.match(sql, /before insert on public\.profiles/);
    assert.match(sql, /set search_path = ''/);
  });
}

test("takenUsernames va parametrizado", () => {
  const query = q.takenUsernames(["x'; drop table profiles; --", "kosmocadet21"]);
  assert.match(query.text, /= any\(\$1::text\[\]\)/);
  assert.ok(!query.text.includes("drop table"));
  assert.equal(query.values.length, 1);
});
