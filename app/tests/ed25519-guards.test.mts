/**
 * Degenerate ed25519 keys and non-canonical signatures must not verify.
 * Reproduces the attack: identity public key + constant signature, which plain
 * RFC 8032 verification (and node:crypto) accepts for ANY message.
 * No real keys anywhere; the keypairs are generated in the test.
 */
import assert from "node:assert/strict";
import { createHash, createPublicKey, verify as rawVerify } from "node:crypto";
import test from "node:test";
import { Keypair, StrKey } from "@stellar/stellar-base";

import { requireSignedAddress, verifySep53 } from "../lib/core/auth.ts";
import { authMessage, PROOF_HEADER } from "../lib/core/auth-message.ts";
import {
  hasCanonicalY,
  isAcceptablePublicKey,
  isCanonicalSignature,
  isSmallOrderPoint,
  SMALL_ORDER_Y_HEX,
} from "../lib/core/ed25519-guards.ts";
import { decodeStellarPublicKey, ed25519PublicKeyFrom } from "../lib/core/strkey.ts";

const SEP53_PREFIX = "Stellar Signed Message:\n";
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

// ---- BigInt curve arithmetic, only to double-check the hardcoded constants ----
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const P = (ONE << BigInt(255)) - BigInt(19);
const L = (ONE << BigInt(252)) + BigInt("27742317777372353535851937790883648493");

const mod = (a: bigint) => ((a % P) + P) % P;
function pow(base: bigint, exp: bigint): bigint {
  let result = ONE;
  let b = mod(base);
  let e = exp;
  while (e > ZERO) {
    if (e & ONE) result = (result * b) % P;
    b = (b * b) % P;
    e >>= ONE;
  }
  return result;
}
const inv = (a: bigint) => pow(a, P - TWO);
const D = mod(-BigInt(121665) * inv(BigInt(121666)));
const SQRT_M1 = pow(TWO, (P - ONE) / BigInt(4));

type Point = [bigint, bigint];

function xFromY(y: bigint, sign: number): bigint | null {
  const y2 = (y * y) % P;
  const x2 = mod((y2 - ONE) * inv(D * y2 + ONE));
  let x = pow(x2, (P + BigInt(3)) / BigInt(8));
  if (mod(x * x - x2) !== ZERO) x = (x * SQRT_M1) % P;
  if (mod(x * x - x2) !== ZERO) return null;
  if (Number(x & ONE) !== sign) x = mod(-x);
  // x = 0 has no "negative" twin: sign bit 1 there is a non-canonical encoding.
  return x === ZERO && sign === 1 ? null : x;
}

function add(a: Point, b: Point): Point {
  const t = (D * a[0] * b[0] * a[1] * b[1]) % P;
  return [mod((a[0] * b[1] + b[0] * a[1]) * inv(ONE + t)), mod((a[1] * b[1] + a[0] * b[0]) * inv(ONE - t))];
}

function leToBig(bytes: Uint8Array): bigint {
  let value = ZERO;
  for (let i = bytes.length - 1; i >= 0; i -= 1) value = (value << BigInt(8)) | BigInt(bytes[i]);
  return value;
}

function bigToLe(value: bigint, length = 32): Buffer {
  const out = Buffer.alloc(length);
  let v = value;
  for (let i = 0; i < length; i += 1) {
    out[i] = Number(v & BigInt(255));
    v >>= BigInt(8);
  }
  return out;
}

test("the small-order blocklist is exactly the 8 torsion points of edwards25519", () => {
  const points: Point[] = [];
  for (const yHex of SMALL_ORDER_Y_HEX) {
    const y = leToBig(Buffer.from(yHex, "hex"));
    for (const sign of [0, 1]) {
      const x = xFromY(y, sign);
      if (x !== null) points.push([x, y]);
    }
  }
  assert.equal(points.length, 8, "the torsion subgroup has 8 elements");
  assert.equal(new Set(points.map((q) => `${q[0]}:${q[1]}`)).size, 8);
  for (const q of points) {
    // On the curve: -x^2 + y^2 = 1 + d x^2 y^2.
    assert.equal(mod(-q[0] * q[0] + q[1] * q[1]), mod(ONE + D * q[0] * q[0] * q[1] * q[1]));
    // 8 * P = identity.
    let r = q;
    for (let i = 0; i < 3; i += 1) r = add(r, r);
    assert.deepEqual(r, [ZERO, ONE]);
  }
});

test("hardcoded p and L match their definitions", () => {
  // p: y = p is the first non-canonical value, y = p - 1 the last canonical one.
  const enc = (y: bigint) => Buffer.from(bigToLe(y));
  assert.equal(hasCanonicalY(enc(P - ONE)), true);
  assert.equal(hasCanonicalY(enc(P)), false);
  assert.equal(hasCanonicalY(enc(P + ONE)), false);
  // The sign bit does not make a non-canonical y canonical.
  const withSign = enc(P);
  withSign[31] |= 0x80;
  assert.equal(hasCanonicalY(withSign), false);

  // L: S = L - 1 is the last accepted scalar, S = L the first refused one.
  const sig = (s: bigint) => Buffer.concat([Buffer.alloc(32, 0), bigToLe(s)]);
  assert.equal(isCanonicalSignature(sig(L - ONE)), true);
  assert.equal(isCanonicalSignature(sig(L)), false);
  assert.equal(isCanonicalSignature(sig(L + ONE)), false);
  assert.equal(isCanonicalSignature(Buffer.alloc(63)), false);
});

// ---- the attack itself ----

function addressOf(raw: Buffer): string {
  return StrKey.encodeEd25519PublicKey(raw);
}

function digestOf(message: string): Buffer {
  return createHash("sha256")
    .update(Buffer.concat([Buffer.from(SEP53_PREFIX, "utf8"), Buffer.from(message, "utf8")]))
    .digest();
}

function rawAccepts(publicKey: Buffer, message: string, signature: Buffer): boolean {
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, publicKey]), format: "der", type: "spki" });
    return rawVerify(null, digestOf(message), key, signature);
  } catch {
    return false;
  }
}

const IDENTITY = Buffer.from("01" + "00".repeat(31), "hex");
/** R = identity, S = 0. */
const CONSTANT_SIGNATURE = Buffer.concat([IDENTITY, Buffer.alloc(32, 0)]);

test("identity key + constant signature: plain verification accepts it, verifySep53 does not", (t) => {
  const address = addressOf(IDENTITY);
  const message = "kosmovia-auth:v1:POST /api/auth/session:anything:1";
  if (!rawAccepts(IDENTITY, message, CONSTANT_SIGNATURE)) {
    t.diagnostic("node:crypto no longer accepts the identity key by itself; the guard is still required");
  }
  for (const encoding of ["base64", "hex"] as const) {
    assert.equal(
      verifySep53({ address, message, signature: CONSTANT_SIGNATURE.toString(encoding) }),
      false,
      encoding,
    );
  }
  // The key never even becomes a key object.
  assert.throws(() => ed25519PublicKeyFrom(address));
});

test("the non-canonical identity (y = p + 1) is refused too", () => {
  const nonCanonical = bigToLe(P + ONE);
  const address = addressOf(nonCanonical);
  const signature = Buffer.concat([nonCanonical, Buffer.alloc(32, 0)]);
  assert.equal(isAcceptablePublicKey(nonCanonical), false);
  assert.equal(verifySep53({ address, message: "m", signature: signature.toString("base64") }), false);
  assert.equal(
    verifySep53({ address, message: "m", signature: CONSTANT_SIGNATURE.toString("base64") }),
    false,
  );
});

test("every small-order key, either sign bit, fails even when the signature is ground to pass the raw check", (t) => {
  let groundAtLeastOnce = 0;
  for (const yHex of SMALL_ORDER_Y_HEX) {
    for (const signBit of [0, 0x80]) {
      const key = Buffer.from(yHex, "hex");
      key[31] |= signBit;
      assert.equal(isSmallOrderPoint(key), true, `${yHex}/${signBit}`);
      assert.equal(isAcceptablePublicKey(key), false);
      const address = addressOf(key);
      // R = identity, S = 0 only needs [k]A = identity, i.e. k = 0 mod ord(A):
      // the attacker grinds the (self-chosen) expiry until the raw check passes.
      for (let exp = 0; exp < 600; exp += 1) {
        const message = authMessage(address, exp, "POST", "/api/auth/session");
        if (rawAccepts(key, message, CONSTANT_SIGNATURE)) groundAtLeastOnce += 1;
        assert.equal(
          verifySep53({ address, message, signature: CONSTANT_SIGNATURE.toString("base64") }),
          false,
        );
      }
    }
  }
  // Informational: how many ground signatures the raw primitive accepted.
  t.diagnostic(`raw node:crypto accepted ${groundAtLeastOnce} ground signatures; verifySep53 accepted none`);
});

test("requireSignedAddress refuses a request signed 'as' the identity key", () => {
  const address = addressOf(IDENTITY);
  const exp = Date.now() + 60_000;
  const proof = { address, exp, signature: CONSTANT_SIGNATURE.toString("base64") };
  const request = new Request("https://kosmovia.test/api/auth/session", {
    method: "POST",
    headers: { [PROOF_HEADER]: JSON.stringify(proof) },
  });
  const outcome = requireSignedAddress(request);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.response.status, 401);
});

test("a signature with S + L (non-canonical S) is refused, the canonical one still verifies", () => {
  const keypair = Keypair.random();
  const message = "kosmovia-auth:v1:POST /api/auth/session:test:2";
  const signature = Buffer.from(keypair.sign(digestOf(message)));
  assert.equal(verifySep53({ address: keypair.publicKey(), message, signature: signature.toString("base64") }), true);

  const s = leToBig(signature.subarray(32));
  assert.ok(s < L);
  const malleable = Buffer.concat([signature.subarray(0, 32), bigToLe(s + L)]);
  assert.equal(isCanonicalSignature(malleable), false);
  assert.equal(
    verifySep53({ address: keypair.publicKey(), message, signature: malleable.toString("base64") }),
    false,
  );
});

test("ordinary keys are untouched by the guards", () => {
  for (let i = 0; i < 50; i += 1) {
    const keypair = Keypair.random();
    assert.equal(isAcceptablePublicKey(decodeStellarPublicKey(keypair.publicKey())), true);
    const message = `ordinary-${i}`;
    const signature = Buffer.from(keypair.sign(digestOf(message))).toString("base64");
    assert.equal(verifySep53({ address: keypair.publicKey(), message, signature }), true);
  }
});
