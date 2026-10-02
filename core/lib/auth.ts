import { createHash, verify as verifySignature } from "node:crypto";
import { ed25519PublicKeyFrom } from "./strkey.ts";
import { authMessage, normalizeRoute, PROOF_HEADER } from "./auth-message.ts";

/**
 * Server-side identity without "Authorization: Bearer".
 *
 * Pollar sessions are DPoP-bound: the signing key lives on the user's device,
 * so a forwarded token proves nothing here. Instead the client signs a short
 * message with `client.stellar.sep53.signMessage()` and we verify the
 * signature with pure cryptography, with no call to Pollar.
 * See docs/ARQUITECTURA.md section 2.
 *
 * Returns plain `Response`s (not `NextResponse`) so tests can run this module
 * under `node --test` without booting Next.
 *
 * Only classic `G...` accounts for now. Smart accounts (`C...`, passkey) sign
 * through WebAuthn, not ed25519: see docs/POLLAR-NOTES.md for what to do later.
 */

export { PROOF_HEADER };

const SEP53_PREFIX = "Stellar Signed Message:\n";
const G_ADDRESS = /^G[A-Z2-7]{55}$/;

/**
 * A proof is a bearer credential for its window. It is bound to one endpoint
 * (see `authMessage`), so only the window is left to shrink: the client signs
 * for 2 minutes and anything claiming more than 3 is refused.
 */
const MAX_TTL_MS = 3 * 60 * 1000;

function decodeSignature(signature: string): Buffer | null {
  const trimmed = signature.trim();
  if (/^[0-9a-fA-F]{128}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  const b64 = Buffer.from(trimmed, "base64");
  return b64.length === 64 ? b64 : null;
}

/** Verifies a SEP-53 message signature against a G... address. Pure crypto, no network call. */
export function verifySep53(opts: { address: string; message: string; signature: string }): boolean {
  if (!G_ADDRESS.test(opts.address)) return false;
  const sig = decodeSignature(opts.signature);
  if (!sig) return false;
  const payload = Buffer.concat([
    Buffer.from(SEP53_PREFIX, "utf8"),
    Buffer.from(opts.message, "utf8"),
  ]);
  const digest = createHash("sha256").update(payload).digest();
  try {
    // The address *is* the public key once out of its base32 envelope.
    return verifySignature(null, digest, ed25519PublicKeyFrom(opts.address), sig);
  } catch {
    return false;
  }
}

export type ProofPayload = { address: string; exp: number; signature: string };

export type AuthOutcome = { ok: true; address: string } | { ok: false; response: Response };

function fail(status: number, error: string, code: string): AuthOutcome {
  return { ok: false, response: Response.json({ error, code }, { status }) };
}

function requestRoute(request: Request): { method: string; path: string } {
  return { method: request.method, path: new URL(request.url).pathname };
}

function reject(request: Request, reason: string): AuthOutcome {
  // Reason and route only: never the address, the signature or the header.
  const { method, path } = requestRoute(request);
  console.warn(`auth.rejected reason=${reason} route=${method} ${normalizeRoute(path)}`);
  return fail(
    401,
    "No se pudo verificar la sesión. Recarga la página e intenta de nuevo.",
    "session_invalid",
  );
}

/**
 * Verifies the caller from the `x-kosmovia-proof` header. Never trusts an
 * address the client merely states in the body: only one that survives
 * signature verification.
 */
export function requireSignedAddress(request: Request): AuthOutcome {
  const raw = request.headers.get(PROOF_HEADER);
  if (!raw) return fail(401, "Falta iniciar sesión", "session_required");

  let proof: Partial<ProofPayload>;
  try {
    proof = JSON.parse(raw) as Partial<ProofPayload>;
  } catch {
    return reject(request, "malformed");
  }
  if (!proof || typeof proof !== "object") return reject(request, "malformed");

  const address = typeof proof.address === "string" ? proof.address.trim() : "";
  const exp = Number(proof.exp);
  const signature = typeof proof.signature === "string" ? proof.signature.trim() : "";
  if (!G_ADDRESS.test(address) || !Number.isFinite(exp) || !signature) {
    // Includes C... (smart) addresses: not supported yet, see POLLAR-NOTES.md.
    return reject(request, "malformed");
  }

  const now = Date.now();
  if (exp < now || exp > now + MAX_TTL_MS) {
    const { method, path } = requestRoute(request);
    console.warn(`auth.rejected reason=expired route=${method} ${normalizeRoute(path)}`);
    return fail(401, "La sesión expiró. Recarga la página e intenta de nuevo.", "session_expired");
  }

  // The signature covers the endpoint being called, so a proof lifted from one
  // request can't be spent on another.
  const { method, path } = requestRoute(request);
  const message = authMessage(address, exp, method, path);
  if (!verifySep53({ address, message, signature })) return reject(request, "bad_signature");

  return { ok: true, address };
}

/** Like {@link requireSignedAddress}, but also enforces the signer is `expected` (ownership checks). */
export function requireAddress(request: Request, expected: string): AuthOutcome {
  const got = requireSignedAddress(request);
  if (!got.ok) return got;
  if (got.address !== expected) {
    return fail(403, "Esta sesión no corresponde a esa cuenta", "wrong_account");
  }
  return got;
}
