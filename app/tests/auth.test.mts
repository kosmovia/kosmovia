/**
 * Abuse cases for the SEP-53 proof, as tests. Keypairs are generated here with
 * @stellar/stellar-base (a devDependency, the reference implementation) while
 * the server verifies with lib/strkey.ts + node:crypto: a permanent cross-check.
 * No real keys anywhere.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Keypair } from "@stellar/stellar-base";

import { authMessage, AUTH_PREFIX, normalizeRoute, PROOF_HEADER } from "../lib/core/auth-message.ts";
import { requireAddress, requireSignedAddress, verifySep53 } from "../lib/core/auth.ts";
import { decodeStellarPublicKey } from "../lib/core/strkey.ts";

const ORIGIN = "https://kosmovia.test";
const SEP53_PREFIX = "Stellar Signed Message:\n";

/** What the browser does in lib/auth-client.ts, minus the Pollar round trip. */
function sign(keypair: Keypair, message: string): string {
  const payload = Buffer.concat([Buffer.from(SEP53_PREFIX, "utf8"), Buffer.from(message, "utf8")]);
  return keypair.sign(createHash("sha256").update(payload).digest()).toString("base64");
}

type ProofOptions = { method?: string; path?: string; exp?: number; signedAs?: string };

/** A request carrying a proof: by default a valid one for the route it calls. */
function requestWithProof(keypair: Keypair, method: string, path: string, options: ProofOptions = {}): Request {
  const exp = options.exp ?? Date.now() + 60_000;
  const address = options.signedAs ?? keypair.publicKey();
  const message = authMessage(address, exp, options.method ?? method, options.path ?? path);
  const proof = { address, exp, signature: sign(keypair, message) };
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { [PROOF_HEADER]: JSON.stringify(proof) },
  });
}

test("the message follows the documented shape", () => {
  const address = Keypair.random().publicKey();
  assert.equal(AUTH_PREFIX, "kosmovia-auth:v1");
  assert.equal(
    authMessage(address, 1234, "post", "/api/auth/session"),
    `kosmovia-auth:v1:POST /api/auth/session:${address}:1234`,
  );
});

test("verifySep53 accepts a valid signature", () => {
  const keypair = Keypair.random();
  const message = "kosmovia-auth:v1:POST /api/auth/session:test:1";
  const signature = sign(keypair, message);
  assert.equal(verifySep53({ address: keypair.publicKey(), message, signature }), true);
  // Hex is accepted too, since some wallets return it.
  const hex = Buffer.from(signature, "base64").toString("hex");
  assert.equal(verifySep53({ address: keypair.publicKey(), message, signature: hex }), true);
});

test("verifySep53 rejects the wrong address", () => {
  const signer = Keypair.random();
  const other = Keypair.random();
  const message = "hello";
  assert.equal(verifySep53({ address: other.publicKey(), message, signature: sign(signer, message) }), false);
});

test("verifySep53 rejects a tampered message", () => {
  const keypair = Keypair.random();
  const signature = sign(keypair, "original");
  assert.equal(verifySep53({ address: keypair.publicKey(), message: "original!", signature }), false);
});

test("verifySep53 rejects garbage signatures and non-G addresses", () => {
  const keypair = Keypair.random();
  const message = "hello";
  const signature = sign(keypair, message);
  assert.equal(verifySep53({ address: keypair.publicKey(), message, signature: "AAAA" }), false);
  assert.equal(verifySep53({ address: keypair.publicKey(), message, signature: "" }), false);

  // A secret seed (S...) and a smart-account style address (C...) are never identities.
  assert.equal(verifySep53({ address: keypair.secret(), message, signature }), false);
  const contractLike = "C" + keypair.publicKey().slice(1);
  assert.equal(verifySep53({ address: contractLike, message, signature }), false);
  assert.equal(verifySep53({ address: "not-an-address", message, signature }), false);
});

test("a proof signed for the endpoint being called is accepted", () => {
  const keypair = Keypair.random();
  const got = requireSignedAddress(requestWithProof(keypair, "POST", "/api/auth/session"));
  assert.equal(got.ok, true);
  assert.equal(got.ok && got.address, keypair.publicKey());
});

test("a proof lifted from one endpoint cannot be spent on another", () => {
  const keypair = Keypair.random();
  const stolen = requestWithProof(keypair, "POST", "/api/wallet/fund", {
    method: "POST",
    path: "/api/auth/session",
  });
  assert.equal(requireSignedAddress(stolen).ok, false);
});

test("a proof cannot be replayed with a different method on the same path", () => {
  const keypair = Keypair.random();
  const path = "/api/communities/abc";
  const escalated = requestWithProof(keypair, "PATCH", path, { method: "GET", path });
  assert.equal(requireSignedAddress(escalated).ok, false);
});

test("one signature covers every id of the same route, and nothing else", () => {
  const keypair = Keypair.random();
  const reused = requestWithProof(keypair, "POST", "/api/communities/abc/join", {
    path: "/api/communities/xyz/join",
  });
  assert.equal(requireSignedAddress(reused).ok, true);
  assert.equal(normalizeRoute("/api/communities/4f8e/join"), "/api/communities/:id/join");
  assert.equal(normalizeRoute("/api/auth/session"), "/api/auth/session");
});

test("an expired proof is refused", () => {
  const keypair = Keypair.random();
  const stale = requestWithProof(keypair, "POST", "/api/auth/session", { exp: Date.now() - 1 });
  const got = requireSignedAddress(stale);
  assert.equal(got.ok, false);
  assert.equal(!got.ok && got.response.status, 401);
});

test("a proof claiming a long life (over 3 minutes) is refused", () => {
  const keypair = Keypair.random();
  const greedy = requestWithProof(keypair, "POST", "/api/auth/session", {
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
  assert.equal(requireSignedAddress(greedy).ok, false);

  // The client's own 2-minute window sits inside the limit.
  const normal = requestWithProof(keypair, "POST", "/api/auth/session", { exp: Date.now() + 2 * 60 * 1000 });
  assert.equal(requireSignedAddress(normal).ok, true);
});

test("a proof cannot claim to be someone else's address", () => {
  const keypair = Keypair.random();
  const victim = Keypair.random().publicKey();
  const forged = requestWithProof(keypair, "POST", "/api/auth/session", { signedAs: victim });
  assert.equal(requireSignedAddress(forged).ok, false);
});

test("a tampered exp invalidates the signature", () => {
  const keypair = Keypair.random();
  const exp = Date.now() + 60_000;
  const proof = {
    address: keypair.publicKey(),
    exp,
    signature: sign(keypair, authMessage(keypair.publicKey(), exp, "POST", "/api/auth/session")),
  };
  const extended = { ...proof, exp: exp + 60_000 };
  const request = new Request(`${ORIGIN}/api/auth/session`, {
    method: "POST",
    headers: { [PROOF_HEADER]: JSON.stringify(extended) },
  });
  assert.equal(requireSignedAddress(request).ok, false);
});

test("a non-G address (smart account) is refused even with a well-formed proof", () => {
  const keypair = Keypair.random();
  const exp = Date.now() + 60_000;
  const contractLike = "C" + keypair.publicKey().slice(1);
  const proof = {
    address: contractLike,
    exp,
    signature: sign(keypair, authMessage(contractLike, exp, "POST", "/api/auth/session")),
  };
  const request = new Request(`${ORIGIN}/api/auth/session`, {
    method: "POST",
    headers: { [PROOF_HEADER]: JSON.stringify(proof) },
  });
  assert.equal(requireSignedAddress(request).ok, false);
});

test("a request with no proof, or junk, is refused", () => {
  assert.equal(requireSignedAddress(new Request(`${ORIGIN}/api/auth/session`, { method: "POST" })).ok, false);
  for (const junk of ["not json", "null", "[]", '{"address":1,"exp":"x"}']) {
    const request = new Request(`${ORIGIN}/api/auth/session`, {
      method: "POST",
      headers: { [PROOF_HEADER]: junk },
    });
    assert.equal(requireSignedAddress(request).ok, false, `accepted: ${junk}`);
  }
});

test("requireAddress enforces the expected signer", () => {
  const keypair = Keypair.random();
  const mine = requestWithProof(keypair, "POST", "/api/auth/session");
  assert.equal(requireAddress(mine, keypair.publicKey()).ok, true);
  const wrong = requireAddress(requestWithProof(keypair, "POST", "/api/auth/session"), Keypair.random().publicKey());
  assert.equal(wrong.ok, false);
  assert.equal(!wrong.ok && wrong.response.status, 403);
});

test("lib/strkey agrees with the reference implementation on real addresses", () => {
  for (let i = 0; i < 200; i++) {
    const keypair = Keypair.random();
    assert.deepEqual(decodeStellarPublicKey(keypair.publicKey()), keypair.rawPublicKey());
  }
});

test("a single altered character in an address is refused", () => {
  const address = Keypair.random().publicKey();
  const swapped = address[30] === "A" ? "B" : "A";
  const mutated = address.slice(0, 30) + swapped + address.slice(31);
  assert.throws(() => decodeStellarPublicKey(mutated));
});
