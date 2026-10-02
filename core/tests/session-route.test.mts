/** POST /api/auth/session: 503 without signing config, a verifiable ES256 token with it. */
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { Keypair } from "@stellar/stellar-base";

import { POST } from "../app/api/auth/session/route.ts";
import { authMessage, PROOF_HEADER } from "../lib/auth-message.ts";
import { profileIdFromWallet } from "../lib/ids.ts";
import { verifySessionJwt } from "../lib/jwt.ts";

function request(kp: Keypair): Request {
  const exp = Date.now() + 60_000;
  const message = authMessage(kp.publicKey(), exp, "POST", "/api/auth/session");
  const payload = Buffer.concat([Buffer.from("Stellar Signed Message:\n"), Buffer.from(message)]);
  const signature = kp.sign(createHash("sha256").update(payload).digest()).toString("base64");
  return new Request("https://kosmovia.test/api/auth/session", {
    method: "POST",
    headers: { [PROOF_HEADER]: JSON.stringify({ address: kp.publicKey(), exp, signature }) },
  });
}

function withEnv(values: Record<string, string | undefined>, fn: () => Promise<void>) {
  return async () => {
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(values)) {
      saved[k] = process.env[k];
      if (values[k] === undefined) delete process.env[k];
      else process.env[k] = values[k];
    }
    try {
      await fn();
    } finally {
      for (const k of Object.keys(saved)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  };
}

test(
  "without signing env it answers 503 supabase_not_configured and still returns the address",
  withEnv({ SUPABASE_JWT_PRIVATE_KEY: undefined, SUPABASE_JWT_KEY_ID: undefined }, async () => {
    const kp = Keypair.random();
    const res = await POST(request(kp));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.code, "supabase_not_configured");
    assert.equal(body.address, kp.publicKey());
    assert.equal(body.token, undefined);
  }),
);

test(
  "with signing env it returns profileId, a token that verifies, and expiresAt",
  withEnv({}, async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    process.env.SUPABASE_JWT_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    process.env.SUPABASE_JWT_KEY_ID = "kid-route";
    try {
      const kp = Keypair.random();
      const res = await POST(request(kp));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.address, kp.publicKey());
      assert.equal(body.profileId, profileIdFromWallet(kp.publicKey()));
      const out = verifySessionJwt(body.token, publicKey);
      assert.equal(out.ok, true);
      if (out.ok) {
        assert.equal(out.header.kid, "kid-route");
        assert.equal(out.claims.sub, body.profileId);
        assert.equal(out.claims.wallet, kp.publicKey());
      }
      assert.ok(body.expiresAt > Date.now());
    } finally {
      delete process.env.SUPABASE_JWT_PRIVATE_KEY;
      delete process.env.SUPABASE_JWT_KEY_ID;
    }
  }),
);

test("without a proof it is still 401", async () => {
  const res = await POST(new Request("https://kosmovia.test/api/auth/session", { method: "POST" }));
  assert.equal(res.status, 401);
});
