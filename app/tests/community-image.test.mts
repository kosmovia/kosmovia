import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-ignore: Node necesita la extensión .ts al importar; Next la resuelve sin ella.
import { COMMUNITY_IMAGE_MAX_BYTES, checkCommunityImage, sniffImage } from "../lib/core/community-image.ts";

const b64 = (bytes: number[]) => Buffer.from(Uint8Array.from(bytes)).toString("base64");
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 16];
const WEBP = [0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50];

test("la foto se acepta solo si sus bytes son WebP, PNG o JPEG", () => {
  assert.equal(sniffImage(Uint8Array.from(PNG)), "png");
  assert.equal(sniffImage(Uint8Array.from(JPEG)), "jpeg");
  assert.equal(sniffImage(Uint8Array.from(WEBP)), "webp");
  assert.ok(checkCommunityImage(`data:image/png;base64,${b64(PNG)}`).ok);
  assert.ok(checkCommunityImage(`data:image/webp;base64,${b64(WEBP)}`).ok);
});

test("se rechaza SVG, HTML disfrazado, tipo que no coincide y lo pesado", () => {
  const svg = Buffer.from('<svg onload="alert(1)"/>').toString("base64");
  assert.equal(checkCommunityImage(`data:image/svg+xml;base64,${svg}`).ok, false);
  const html = Buffer.from("<html><script>x</script>").toString("base64");
  assert.equal(checkCommunityImage(`data:image/png;base64,${html}`).ok, false, "dice PNG pero es HTML");
  assert.equal(checkCommunityImage(`data:image/jpeg;base64,${b64(PNG)}`).ok, false, "dice JPEG pero es PNG");
  const big = Buffer.alloc(COMMUNITY_IMAGE_MAX_BYTES + 1);
  Uint8Array.from(PNG).forEach((v, i) => (big[i] = v));
  assert.equal(checkCommunityImage(`data:image/png;base64,${big.toString("base64")}`).ok, false);
  assert.equal(checkCommunityImage("https://evil.example/x.png").ok, false);
  assert.equal(checkCommunityImage(42).ok, false);
});

test("0005_imagen_comunidad.sql: columna con CHECK de formato y tamaño", () => {
  const sql = readFileSync(new URL("../db/migrations/0005_imagen_comunidad.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists image text/);
  assert.match(sql, /webp\|png\|jpeg/);
  assert.match(sql, /char_length\(image\) <= 90000/);
});
