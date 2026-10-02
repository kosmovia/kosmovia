/**
 * Input hygiene for ed25519, in front of `node:crypto`'s verify.
 *
 * Plain RFC 8032 verification accepts degenerate inputs: with the identity
 * point as public key and the identity as R with S = 0, the check
 * `[S]B == R + [k]A` holds for EVERY message, so a constant 64-byte signature
 * "verifies" against that key (and the non-canonical encoding of the identity,
 * y = p + 1, does too). A `G...` address is just 32 attacker-chosen bytes, so
 * without these guards anyone could "sign" as the address of such a key.
 *
 * Rejected here, before verifying:
 * - public keys whose y is not canonical (y >= p);
 * - public keys of small order (the 8 torsion points; in terms of y that is
 *   y in {0, 1, p-1, and the two order-8 values}, with either sign bit);
 * - signatures whose R has a non-canonical y, or whose S is not < L.
 *
 * Constants are the same blocklist libsodium uses; tests/ed25519-guards.test.mts
 * re-derives them with BigInt curve arithmetic and checks 8*P = identity.
 * Plain byte comparisons (no BigInt literals: the TS target is ES2017).
 */

function hex(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "hex"));
}

/** p = 2^255 - 19, little-endian. */
const P_LE = hex("edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f");

/** L = 2^252 + 27742317777372353535851937790883648493 (group order), little-endian. */
const L_LE = hex("edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010");

/** y coordinates (little-endian, sign bit cleared) of the small-order points. */
export const SMALL_ORDER_Y_HEX: readonly string[] = [
  // y = 0 (order 4)
  "0000000000000000000000000000000000000000000000000000000000000000",
  // y = 1 (identity, order 1)
  "0100000000000000000000000000000000000000000000000000000000000000",
  // y = p - 1 (order 2)
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  // order 8
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
  // order 8
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
];

const SMALL_ORDER_Y_LE: readonly Uint8Array[] = SMALL_ORDER_Y_HEX.map(hex);

/** Compares two 32-byte little-endian integers: -1, 0 or 1. */
function compareLE(a: Uint8Array, b: Uint8Array): number {
  for (let i = 31; i >= 0; i -= 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** The y coordinate of a compressed point: the 32 bytes without the sign bit. */
function yOf(encoded: Uint8Array): Uint8Array {
  const y = Uint8Array.from(encoded.subarray(0, 32));
  y[31] &= 0x7f;
  return y;
}

/** y < p. Encodings with y >= p are non-canonical (a second spelling of a point). */
export function hasCanonicalY(encoded: Uint8Array): boolean {
  return encoded.length >= 32 && compareLE(yOf(encoded), P_LE) < 0;
}

/** True for any of the 8 small-order points (either sign bit). Assumes a canonical y. */
export function isSmallOrderPoint(encoded: Uint8Array): boolean {
  if (encoded.length < 32) return true;
  const y = yOf(encoded);
  return SMALL_ORDER_Y_LE.some((bad) => compareLE(y, bad) === 0);
}

/** A public key worth verifying against: 32 bytes, canonical y, not of small order. */
export function isAcceptablePublicKey(key: Uint8Array): boolean {
  return key.length === 32 && hasCanonicalY(key) && !isSmallOrderPoint(key);
}

/** A signature worth verifying: 64 bytes, R with canonical y, and S < L. */
export function isCanonicalSignature(signature: Uint8Array): boolean {
  if (signature.length !== 64) return false;
  if (!hasCanonicalY(signature.subarray(0, 32))) return false;
  return compareLE(signature.subarray(32, 64), L_LE) < 0;
}
