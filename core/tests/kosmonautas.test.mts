import test from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: Node necesita la extensión .ts al importar; Next la resuelve sin ella.
import { CATEGORIAS, CODIGO_RE, RASGOS, aleatorio, atributos, azarFijo, codificar, decodificar, esCodigoValido, svg } from "../lib/avatar/kosmonautas.ts";
// @ts-ignore
import { isValidAvatarSeed, renderAvatar } from "../lib/avatar/generator.ts";

test("codificar y decodificar son inversos y el código es válido para la base", () => {
  const rnd = azarFijo(1);
  for (let i = 0; i < 200; i++) {
    const sel = aleatorio(undefined, {}, rnd);
    const code = codificar(sel);
    assert.match(code, CODIGO_RE);
    assert.ok(esCodigoValido(code), code);
    assert.ok(isValidAvatarSeed(code), code);
    assert.deepEqual(decodificar(code), sel);
  }
});

test("solo hay un código por combinación: ceros a la izquierda y posiciones fuera de rango no valen", () => {
  for (const bad of ["k1.01.0.0.0.0.0.0", "k1.0.0.0.0.0.0", "k1.0.0.0.0.0.0.0.0", "k2.0.0.0.0.0.0.0", "k1.99.0.0.0.0.0.0", "", null, 5]) {
    assert.equal(esCodigoValido(bad), false, String(bad));
  }
  assert.equal(esCodigoValido("k1.0.0.0.0.0.0.0"), true);
});

test("un código inválido igual dibuja un Kosmonauta estable", () => {
  assert.deepEqual(decodificar("basura"), decodificar("basura"));
  assert.equal(renderAvatar("basura", "kosmonauta"), renderAvatar("basura", "kosmonauta"));
  assert.notEqual(renderAvatar("k1.0.0.0.0.0.0.0", "kosmonauta"), renderAvatar("k1.1.0.0.0.0.0.0", "kosmonauta"));
});

test("Aleatorio respeta los rasgos con candado", () => {
  const base = decodificar("k1.2.1.3.0.4.1.5");
  const rnd = azarFijo(9);
  for (let i = 0; i < 50; i++) {
    const s = aleatorio(base, { casco: true, ojos: true }, rnd);
    assert.equal(s.casco, base.casco);
    assert.equal(s.ojos, base.ojos);
  }
});

test("el SVG solo tiene rects con colores hexadecimales", () => {
  const rnd = azarFijo(3);
  for (let i = 0; i < 50; i++) {
    const out = svg(aleatorio(undefined, {}, rnd));
    assert.match(out, /^<svg [^>]*viewBox="0 0 24 24"/);
    const inner = out.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
    assert.match(inner, /^(<rect x="\d+" y="\d+" width="\d+" height="1" fill="#[0-9A-F]{6}"\/>)+$/);
  }
});

test("los ids de rasgos son únicos y atributos sigue el formato de OpenSea", () => {
  for (const { key } of CATEGORIAS) {
    const ids = RASGOS[key].map((r: { id: string }) => r.id);
    assert.equal(new Set(ids).size, ids.length, key);
  }
  const attrs = atributos(decodificar("k1.0.0.0.0.0.0.0"));
  assert.equal(attrs.length, CATEGORIAS.length + 1);
  for (const a of attrs) assert.deepEqual(Object.keys(a).sort(), ["trait_type", "value"]);
  assert.deepEqual(attrs.at(-1), { trait_type: "Rareza", value: "Común" });
});
