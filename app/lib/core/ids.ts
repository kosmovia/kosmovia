import { createHash } from "node:crypto";

/**
 * Deterministic ids (RFC 4122 UUID v5). A profile's id is derived from the
 * wallet address, so the server can mint the session JWT (`sub`) with no
 * database lookup and the `profiles` row uses that same id.
 *
 * Server-only (node:crypto).
 */

/** Namespace for Kosmovia profile ids. NEVER change it: every profile id derives from it. */
export const PROFILE_NAMESPACE = "6f1c2b8e-3d4a-4e5b-9c7a-1b2d3e4f5a6b";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** UUID v5 (SHA-1) of `name` inside `namespace`. */
export function uuidv5(name: string, namespace: string): string {
  if (!isUuid(namespace)) throw new Error("namespace must be a UUID");
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(ns).update(Buffer.from(name, "utf8")).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The profile id for a Stellar address. Same wallet, same id, forever. */
export function profileIdFromWallet(address: string): string {
  return uuidv5(address.trim(), PROFILE_NAMESPACE);
}
