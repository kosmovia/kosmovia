/**
 * Session JWT (ES256) and deterministic profile ids. Keys are generated here:
 * no real keys anywhere.
 */
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { profileIdFromWallet, PROFILE_NAMESPACE, uuidv5 } from "../lib/core/ids.ts";
import {
  JWT_TTL_SECONDS,
  normalizePem,
  readJwtConfig,
  signSessionJwt,
  verifySessionJwt,
} from "../lib/core/jwt.ts";

const WALLET = "GDEMOKOSMOVIATESTNETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const NOW = 1_800_000_000_000;

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    privateKey,
    publicKey,
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

test("uuidv5 matches the RFC vector (python.org in the DNS namespace)", () => {
  assert.equal(uuidv5("python.org", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"), "886313e1-3b8a-5372-9b90-0c9aee199e5d");
});

test("profile ids are deterministic, v5-shaped and wallet-specific", () => {
  const a = profileIdFromWallet(WALLET);
  assert.equal(a, profileIdFromWallet(WALLET));
  assert.equal(a, profileIdFromWallet(`  ${WALLET} `));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a, profileIdFromWallet(WALLET.replace(/X$/, "Y")));
  assert.equal(a, uuidv5(WALLET, PROFILE_NAMESPACE));
});

test("uuidv5 rejects a namespace that is not a UUID", () => {
  assert.throws(() => uuidv5("x", "not-a-uuid"));
});

test("the JWT carries the documented header and claims and verifies", () => {
  const k = keys();
  const profileId = profileIdFromWallet(WALLET);
  const { token, expiresAt, claims } = signSessionJwt({
    privateKeyPem: k.privatePem,
    keyId: "kid-test",
    profileId,
    wallet: WALLET,
    now: NOW,
  });
  const out = verifySessionJwt(token, k.publicKey, NOW + 1000);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepEqual(out.header, { alg: "ES256", typ: "JWT", kid: "kid-test" });
  assert.equal(out.claims.sub, profileId);
  assert.equal(out.claims.role, "authenticated");
  assert.equal(out.claims.aud, "authenticated");
  assert.equal(out.claims.iss, "kosmovia-core");
  assert.equal(out.claims.wallet, WALLET);
  assert.equal(out.claims.iat, NOW / 1000);
  assert.equal(out.claims.exp, NOW / 1000 + JWT_TTL_SECONDS);
  assert.equal(JWT_TTL_SECONDS, 3600);
  assert.equal(expiresAt, claims.exp * 1000);
  // Raw r||s, 64 bytes, as JWS requires.
  assert.equal(Buffer.from(token.split(".")[2], "base64url").length, 64);
});

test("the JWT is rejected after expiry, with another key, or if tampered with", () => {
  const k = keys();
  const other = keys();
  const { token } = signSessionJwt({
    privateKeyPem: k.privatePem,
    keyId: "kid-test",
    profileId: profileIdFromWallet(WALLET),
    wallet: WALLET,
    now: NOW,
  });
  assert.deepEqual(verifySessionJwt(token, k.publicKey, NOW + 3601_000), { ok: false, reason: "expired" });
  assert.deepEqual(verifySessionJwt(token, other.publicKey, NOW), { ok: false, reason: "bad_signature" });

  const [h, p, s] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), sub: "other" })).toString("base64url");
  assert.deepEqual(verifySessionJwt(`${h}.${forged}.${s}`, k.publicKey, NOW), { ok: false, reason: "bad_signature" });
  assert.deepEqual(verifySessionJwt("a.b", k.publicKey, NOW), { ok: false, reason: "malformed" });
});

test("a PEM with literal \\n (single-line env var) still signs", () => {
  const k = keys();
  const oneLine = k.privatePem.trim().replace(/\n/g, "\\n");
  assert.equal(normalizePem(`"${oneLine}"`), k.privatePem.trim());
  const { token } = signSessionJwt({ privateKeyPem: oneLine, keyId: "k", profileId: profileIdFromWallet(WALLET), wallet: WALLET, now: NOW });
  assert.equal(verifySessionJwt(token, k.publicKey, NOW).ok, true);
});

test("readJwtConfig needs both variables", () => {
  assert.deepEqual(readJwtConfig({}), { ok: false });
  assert.deepEqual(readJwtConfig({ SUPABASE_JWT_PRIVATE_KEY: "pem" }), { ok: false });
  assert.deepEqual(readJwtConfig({ SUPABASE_JWT_PRIVATE_KEY: " pem ", SUPABASE_JWT_KEY_ID: "kid" }), {
    ok: true,
    privateKeyPem: "pem",
    keyId: "kid",
  });
});
