import test from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: Node necesita la extensión .ts al importar; Next la resuelve sin ella.
import { AVATAR_PALETTE, AVATAR_STYLES, pickStyle, randomSeed, renderAvatar, suggestions } from "../lib/avatar/generator.ts";

const ADDR = "GDEMOKOSMOVIATESTNETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

test("mismo seed y estilo dan el mismo SVG", () => {
  for (const s of AVATAR_STYLES) {
    assert.equal(renderAvatar("abc", s), renderAvatar("abc", s));
  }
  assert.equal(renderAvatar("abc"), renderAvatar("abc", pickStyle("abc")));
});

test("seeds distintos dan SVG distintos", () => {
  for (const s of AVATAR_STYLES) {
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
  for (const s of AVATAR_STYLES) {
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
