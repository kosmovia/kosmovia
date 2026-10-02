/** The api backend's session cookie: HS256 sign/verify, tampering, expiry, algorithm confusion, and requireSession. */
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import test from "node:test";
import { Keypair } from "@stellar/stellar-base";

import { profileIdFromWallet } from "../lib/ids.ts";
import {
  MIN_SECRET_BYTES,
  originAllowed,
  readCookie,
  readSessionSecret,
  requireSession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionClearCookie,
  sessionSetCookie,
  signSessionCookie,
  verifySessionCookie,
} from "../lib/session-cookie.ts";

const secret = randomBytes(48);
const wallet = Keypair.random().publicKey();
const b64 = (v: object | string) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

/** A token built by hand, to craft what signSessionCookie would never produce. */
function forge(header: object, claims: object, key: Buffer = secret, alg = "sha256"): string {
  const input = `${b64(header)}.${b64(claims)}`;
  return `${input}.${createHmac(alg, key).update(input).digest().toString("base64url")}`;
}

const goodClaims = (now = Date.now()) => ({
  sub: profileIdFromWallet(wallet),
  wallet,
  iat: Math.floor(now / 1000),
  exp: Math.floor(now / 1000) + 3600,
});

test("a cookie signs and verifies, with sub = uuid v5 of the wallet and a 12 hour life", () => {
  const now = Date.now();
  const { token, expiresAt, claims } = signSessionCookie({ secret, wallet, now });
  assert.equal(claims.sub, profileIdFromWallet(wallet));
  assert.equal(claims.wallet, wallet);
  assert.equal(SESSION_TTL_SECONDS, 12 * 60 * 60);
  assert.equal(claims.exp - claims.iat, SESSION_TTL_SECONDS);
  assert.equal(expiresAt, claims.exp * 1000);
  const out = verifySessionCookie(token, secret, now + 1000);
  assert.equal(out.ok, true);
  if (out.ok) assert.deepEqual(out.claims, claims);
  const header = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
  assert.equal(header.alg, "HS256");
});

test("a tampered payload or signature is refused", () => {
  const { token } = signSessionCookie({ secret, wallet });
  const [h, p, s] = token.split(".");
  const other = Keypair.random().publicKey();
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  // Same signature, swapped identity.
  const swapped = `${h}.${b64({ ...claims, sub: profileIdFromWallet(other), wallet: other })}.${s}`;
  assert.deepEqual(verifySessionCookie(swapped, secret), { ok: false, reason: "bad_signature" });
  // One flipped bit of the signature.
  const sig = Buffer.from(s, "base64url");
  sig[0] ^= 1;
  assert.deepEqual(verifySessionCookie(`${h}.${p}.${sig.toString("base64url")}`, secret), {
    ok: false,
    reason: "bad_signature",
  });
  // Truncated and extended signatures (length is checked before the constant-time compare).
  assert.equal(verifySessionCookie(`${h}.${p}.${s.slice(0, -4)}`, secret).ok, false);
  assert.equal(verifySessionCookie(`${h}.${p}.${s}AAAA`, secret).ok, false);
  // Another secret.
  assert.deepEqual(verifySessionCookie(token, randomBytes(48)), { ok: false, reason: "bad_signature" });
});

test("an expired cookie is refused, one second before expiry is not", () => {
  const now = Date.now();
  const { token, expiresAt } = signSessionCookie({ secret, wallet, now, ttlSeconds: 60 });
  assert.equal(verifySessionCookie(token, secret, expiresAt - 1000).ok, true);
  assert.deepEqual(verifySessionCookie(token, secret, expiresAt), { ok: false, reason: "expired" });
  assert.deepEqual(verifySessionCookie(token, secret, expiresAt + 86_400_000), { ok: false, reason: "expired" });
});

test("only HS256 is accepted: none, other HMACs, RS256, and a missing alg are refused", () => {
  const claims = goodClaims();
  // alg none with an empty signature, and with a "valid-looking" one.
  assert.deepEqual(verifySessionCookie(`${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.`, secret), {
    ok: false,
    reason: "alg",
  });
  assert.equal(verifySessionCookie(`${b64({ alg: "none" })}.${b64(claims)}.AAAA`, secret).ok, false);
  // HS384/HS512 with a MAC that is correct for that algorithm and the right secret.
  assert.deepEqual(verifySessionCookie(forge({ alg: "HS384", typ: "JWT" }, claims, secret, "sha384"), secret), {
    ok: false,
    reason: "alg",
  });
  assert.deepEqual(verifySessionCookie(forge({ alg: "HS512", typ: "JWT" }, claims, secret, "sha512"), secret), {
    ok: false,
    reason: "alg",
  });
  assert.equal(verifySessionCookie(forge({ alg: "RS256", typ: "JWT" }, claims), secret).ok, false);
  assert.equal(verifySessionCookie(forge({ typ: "JWT" }, claims), secret).ok, false);
  assert.equal(verifySessionCookie(forge({ alg: "hs256" }, claims), secret).ok, false);
  // The honest forgery (right alg, right secret) does verify: this is what a valid token is.
  assert.equal(verifySessionCookie(forge({ alg: "HS256", typ: "JWT" }, claims), secret).ok, true);
});

test("claims are checked: sub must be the id of the wallet, wallet must be a G address, types must be right", () => {
  const head = { alg: "HS256", typ: "JWT" };
  const good = goodClaims();
  assert.equal(verifySessionCookie(forge(head, { ...good, sub: profileIdFromWallet(Keypair.random().publicKey()) }), secret).ok, false);
  assert.equal(verifySessionCookie(forge(head, { ...good, wallet: "CABC" }), secret).ok, false);
  assert.equal(verifySessionCookie(forge(head, { ...good, exp: "9999999999" }), secret).ok, false);
  assert.equal(verifySessionCookie(forge(head, { ...good, iat: undefined }), secret).ok, false);
  // iat far in the future.
  assert.equal(verifySessionCookie(forge(head, goodClaims(Date.now() + 3_600_000)), secret).ok, false);
  // Not JSON, not three parts, junk characters, absurd length.
  for (const junk of ["", "a.b", "a.b.c.d", "not a token", `${b64("x")}.${b64("y")}.z`, "a".repeat(5000)]) {
    assert.equal(verifySessionCookie(junk, secret).ok, false, junk.slice(0, 20));
  }
});

test("the secret must be 32 bytes or more: shorter or missing is rejected everywhere", () => {
  assert.equal(readSessionSecret({}), null);
  assert.equal(readSessionSecret({ SESSION_SECRET: "" }), null);
  assert.equal(readSessionSecret({ SESSION_SECRET: "x".repeat(MIN_SECRET_BYTES - 1) }), null);
  assert.equal(readSessionSecret({ SESSION_SECRET: "x".repeat(MIN_SECRET_BYTES) })?.length, MIN_SECRET_BYTES);
  // Bytes, not characters: 16 two-byte characters are 32 bytes.
  assert.notEqual(readSessionSecret({ SESSION_SECRET: "é".repeat(16) }), null);
  assert.throws(() => signSessionCookie({ secret: Buffer.alloc(31), wallet }));
  const { token } = signSessionCookie({ secret, wallet });
  assert.equal(verifySessionCookie(token, Buffer.alloc(31)).ok, false);
});

test("cookie attributes: httpOnly, SameSite=Lax, Path=/, Secure only when asked, Max-Age", () => {
  const dev = sessionSetCookie("tok", 100, false);
  assert.match(dev, new RegExp(`^${SESSION_COOKIE}=tok; `));
  for (const attr of ["Path=/", "Max-Age=100", "HttpOnly", "SameSite=Lax"]) assert.ok(dev.includes(attr), attr);
  assert.ok(!dev.includes("Secure"));
  assert.ok(sessionSetCookie("tok", 100, true).includes("; Secure"));
  const cleared = sessionClearCookie(true);
  assert.ok(cleared.startsWith(`${SESSION_COOKIE}=;`));
  assert.ok(cleared.includes("Max-Age=0") && cleared.includes("HttpOnly") && cleared.includes("Secure"));
});

test("readCookie picks the right cookie out of a header", () => {
  assert.equal(readCookie(null, "a"), null);
  assert.equal(readCookie("a=1; kosmovia_session=abc.def.ghi; b=2", "kosmovia_session"), "abc.def.ghi");
  assert.equal(readCookie("xkosmovia_session=nope", "kosmovia_session"), null);
  assert.equal(readCookie("kosmovia_session=a=b", "kosmovia_session"), "a=b");
});

test("originAllowed: GETs and origin-less requests pass; a foreign Origin on a write does not", () => {
  const req = (method: string, origin?: string, host = "kosmovia.test") =>
    new Request("https://kosmovia.test/api/x", { method, headers: { ...(origin ? { origin } : {}), host } });
  assert.equal(originAllowed(req("GET", "https://evil.test")), true);
  assert.equal(originAllowed(req("POST")), true);
  assert.equal(originAllowed(req("POST", "https://kosmovia.test")), true);
  assert.equal(originAllowed(req("POST", "https://evil.test")), false);
  assert.equal(originAllowed(req("PATCH", "null")), false);
  assert.equal(originAllowed(req("POST", "not a url")), false);
});

test("requireSession: no cookie 401, good cookie ok, tampered/expired 401, bad origin 403, no secret 503", async () => {
  // The secret travels as an env string, so use a string one here.
  const strSecret = randomBytes(24).toString("hex");
  const good = signSessionCookie({ secret: Buffer.from(strSecret), wallet });
  const e = { SESSION_SECRET: strSecret };
  const call = (cookie?: string, extra: Record<string, string> = {}, method = "GET", environment = e) =>
    requireSession(
      new Request("https://kosmovia.test/api/profile", { method, headers: { ...(cookie ? { cookie } : {}), ...extra } }),
      environment,
    );

  const none = call();
  assert.equal(none.ok, false);
  if (!none.ok) {
    assert.equal(none.response.status, 401);
    assert.equal((await none.response.json()).code, "session_required");
  }

  const ok = call(`${SESSION_COOKIE}=${good.token}`);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.profileId, profileIdFromWallet(wallet));
    assert.equal(ok.wallet, wallet);
    assert.equal(ok.expiresAt, good.expiresAt);
  }

  const tampered = call(`${SESSION_COOKIE}=${good.token.slice(0, -2)}xx`);
  assert.equal(tampered.ok, false);
  if (!tampered.ok) assert.equal(tampered.response.status, 401);

  const old = signSessionCookie({ secret: Buffer.from(strSecret), wallet, now: Date.now() - 13 * 3600_000 });
  const expired = call(`${SESSION_COOKIE}=${old.token}`);
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal((await expired.response.json()).code, "session_expired");

  const cross = call(`${SESSION_COOKIE}=${good.token}`, { origin: "https://evil.test", host: "kosmovia.test" }, "POST");
  assert.equal(cross.ok, false);
  if (!cross.ok) assert.equal(cross.response.status, 403);

  const noSecret = call(`${SESSION_COOKIE}=${good.token}`, {}, "GET", { SESSION_SECRET: "short" });
  assert.equal(noSecret.ok, false);
  if (!noSecret.ok) assert.equal((await noSecret.response.json()).code, "session_not_configured");
});
