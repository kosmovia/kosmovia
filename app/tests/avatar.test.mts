import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-ignore: Node necesita la extensión .ts al importar; Next la resuelve sin ella.
import { AVATAR_PALETTE, AVATAR_STYLES, LEGACY_AVATAR_STYLES, isValidAvatarSeed, pickStyle, randomSeed, renderAvatar, suggestions } from "../lib/core/avatar/generator.ts";

const ADDR = "GDEMOKOSMOVIATESTNETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

test("mismo seed y estilo dan el mismo SVG", () => {
  for (const s of LEGACY_AVATAR_STYLES) {
    assert.equal(renderAvatar("abc", s), renderAvatar("abc", s));
  }
  assert.equal(renderAvatar("abc"), renderAvatar("abc", pickStyle("abc")));
});

test("seeds distintos dan SVG distintos", () => {
  for (const s of LEGACY_AVATAR_STYLES) {
    const set = new Set(Array.from({ length: 20 }, (_, i) => renderAvatar(`seed-${i}`, s)));
    assert.equal(set.size, 20, `estilo ${s}`);
  }
});

test("las sugerencias de una dirección son estables y 6 distintas", () => {
  const a = suggestions(ADDR);
  assert.deepEqual(a, suggestions(ADDR));
  assert.equal(a.length, 6);
  assert.equal(new Set(a.map((x: { seed: string }) => x.seed)).size, 6);
  assert.equal(new Set(a.map((x: { style: string }) => x.style)).size, 6);
  assert.equal(new Set(a.map((x: { seed: string; style: any }) => renderAvatar(x.seed, x.style))).size, 6);
  assert.notDeepEqual(a, suggestions(ADDR + "Z"));
});

test("randomSeed da valores distintos", () => {
  assert.notEqual(randomSeed(), randomSeed());
  assert.match(randomSeed(), /^[0-9a-f]{16}$/);
});

test("el SVG solo usa colores de la paleta y nada peligroso", () => {
  const allowed = new Set(AVATAR_PALETTE.map((c: string) => c.toLowerCase()));
  for (const s of LEGACY_AVATAR_STYLES) {
    for (let i = 0; i < 25; i++) {
      const svg = renderAvatar(`GX${i}`, s);
      assert.match(svg, /^<svg [^>]*viewBox="0 0 256 256"/);
      for (const hex of svg.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
        // Los "#kv..." de url(#id) no son colores: solo se revisan los que son hexadecimales puros.
        if (/^#[0-9a-f]{6}$/i.test(hex)) assert.ok(allowed.has(hex.toLowerCase()), `${s}: color fuera de la paleta ${hex}`);
      }
      assert.ok(!/fill="#(?![0-9a-f]{6}")/i.test(svg.replace(/url\(#[^)]*\)/g, "")), `${s}: fill no hexadecimal de 6`);
      assert.ok(!/<script/i.test(svg));
      assert.ok(!/href\s*=/i.test(svg));
      assert.ok(!/foreignObject/i.test(svg));
      assert.ok(!/<image|<style|font-family|on\w+=/i.test(svg));
      assert.ok(!/NaN|undefined|Infinity/.test(svg), `${s}: número inválido`);
    }
  }
});

// ---------- Endurecimiento: semilla y estilo no confiables ----------

const NASTY = [
  '"><script>alert(1)</script>',
  "'\"><img src=x onerror=alert(1)>",
  "</svg><script>alert(1)</script><svg>",
  "x".repeat(10_000),
  "\u0000\u2028<>&\"'`${}",
];

test("una semilla o un estilo con markup nunca llega al SVG", () => {
  for (const nasty of NASTY) {
    for (const [seed, style] of [
      [nasty, undefined],
      [nasty, nasty],
      ["ok", nasty],
      [nasty, "astronaut"],
    ] as const) {
      const svg = renderAvatar(seed, style as any);
      assert.match(svg, /^<svg [^>]*viewBox="0 0 256 256"/);
      assert.ok(!/<script/i.test(svg), "sin <script");
      assert.ok(!svg.includes("alert"), "el texto de la semilla no aparece");
      // ('"><' a secas sí aparece en SVG legítimo, p. ej. <linearGradient ...><stop.)
      assert.ok(!svg.includes('"><script') && !svg.includes('"><img'), 'ni "><script');
      assert.ok(!/onerror|onload|<img|<\/svg><|javascript:/i.test(svg));
      // Los únicos ids/urls son "kv" + base36 derivado del hash.
      for (const id of svg.match(/id="[^"]*"/g) ?? []) assert.match(id, /^id="kv[a-z0-9]+[a-z0-9]*"$/);
      for (const ref of svg.match(/url\(#[^)]*\)/g) ?? []) assert.match(ref, /^url\(#kv[a-z0-9]+\)$/);
      assert.equal((svg.match(/<svg/g) ?? []).length, 1);
    }
  }
});

test("un estilo desconocido se ignora: sale el estilo que elige pickStyle", () => {
  for (const bad of ["../etc", "ASTRONAUT", "", "toString", "__proto__", "<b>", 5, null, {}]) {
    assert.equal(renderAvatar("abc", bad as any), renderAvatar("abc"));
    assert.equal(renderAvatar("abc", bad as any), renderAvatar("abc", pickStyle("abc")));
  }
});

test("la semilla se recorta a 64 caracteres", () => {
  const long = "a".repeat(64);
  assert.equal(renderAvatar(long + "bcd", "rocket"), renderAvatar(long, "rocket"));
  assert.equal(renderAvatar(long + "bcd"), renderAvatar(long));
  assert.notEqual(renderAvatar("a".repeat(63) + "b", "rocket"), renderAvatar(long, "rocket"));
  // Una semilla de 1 MB no hace trabajo extra ni cambia el tamaño del SVG de forma relevante.
  const huge = renderAvatar("z".repeat(1_000_000), "portal");
  assert.ok(huge.length < 60_000);
  // Valores que no son texto no rompen nada.
  assert.equal(renderAvatar(undefined as any, "portal"), renderAvatar("", "portal"));
});

test("isValidAvatarSeed acepta lo que genera la app y rechaza el resto", () => {
  for (const ok of [randomSeed(), `${ADDR}:3`, "seed-1", "a.b_c:d"]) assert.equal(isValidAvatarSeed(ok), true, ok);
  for (const bad of ["", "a".repeat(65), '"><script>', "con espacio", "ñandú", 5, null, undefined]) {
    assert.equal(isValidAvatarSeed(bad), false, String(bad));
  }
  for (const s of suggestions(ADDR)) assert.equal(isValidAvatarSeed(s.seed), true);
});

test("la última migración de Supabase lista exactamente los estilos del generador", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0003_kosmonautas.sql", import.meta.url), "utf8");
  const found = /avatar_style in\s*\(([^)]*)\)/.exec(sql);
  assert.ok(found, "falta el CHECK de avatar_style");
  const listed = [...found![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(listed, [...AVATAR_STYLES].sort());
});
