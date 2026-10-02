/**
 * X verification: URL rules, code derivation, oEmbed parsing and the verify
 * flow with an injected fetcher. No real network and no real keys anywhere.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Keypair } from "@stellar/stellar-base";

import { authMessage, PROOF_HEADER } from "../lib/auth-message.ts";
import {
  acceptedCodes,
  BUCKET_MS,
  bucketOf,
  challengeFor,
  deriveCode,
  extractPostText,
  handleFromAuthorUrl,
  oembedUrl,
  parseXPostUrl,
  textHasCode,
  verifyXPost,
  type Fetcher,
} from "../lib/x-verify.ts";
import { POST as challengeRoute } from "../app/api/x/challenge/route.ts";
import { POST as verifyRoute } from "../app/api/x/verify/route.ts";

const SECRET = "test-secret-not-real-0123456789";
const WALLET = Keypair.random().publicKey();
const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);

// --------------------------------------------------------------------- URLs

test("parseXPostUrl accepts the good forms", () => {
  const good = [
    "https://x.com/jack/status/20",
    "https://twitter.com/jack/status/20",
    "https://www.x.com/jack/status/20",
    "https://mobile.twitter.com/jack/status/20",
    "https://x.com/jack/status/20/",
    "https://x.com/jack/status/20?s=20&t=abc",
    "https://x.com/jack/status/20#top",
    "  https://x.com/jack/status/20  ",
    "https://X.COM/jack/status/20",
  ];
  for (const url of good) {
    const ref = parseXPostUrl(url);
    assert.deepEqual(ref, { handle: "jack", id: "20", canonicalUrl: "https://x.com/jack/status/20" }, url);
  }
  assert.equal(parseXPostUrl("https://x.com/Some_User1/status/1234567890123456789")?.handle, "Some_User1");
});

test("parseXPostUrl rejects everything else", () => {
  const bad = [
    "",
    "not a url",
    "http://x.com/jack/status/20",
    "ftp://x.com/jack/status/20",
    "https://evil.com/jack/status/20",
    "https://x.com.evil.com/jack/status/20",
    "https://evilx.com/jack/status/20",
    "https://notx.com/jack/status/20",
    "https://x.com@evil.com/jack/status/20",
    "https://evil.com@x.com/jack/status/20",
    "https://x.com:evil@x.com/jack/status/20",
    "https://x.com:8443/jack/status/20",
    "https://x.com./jack/status/20",
    "https://x.com\\@evil.com/jack/status/20",
    "https://x.com/jack/status/20/photo/1",
    "https://x.com/jack/status/20/extra",
    "https://x.com/jack/status",
    "https://x.com/jack/status/",
    "https://x.com/jack/status/abc",
    "https://x.com/jack/status/20abc",
    "https://x.com/jack/status/-20",
    "https://x.com/jack/status/%32%30",
    "https://x.com/jack/likes/20",
    "https://x.com/jack",
    "https://x.com/",
    "https://x.com//status/20",
    "https://x.com/i/status/20",
    "https://x.com/i/web/status/20",
    "https://x.com/ja%63k/status/20",
    "https://x.com/jack%2f..%2fstatus/20",
    "https://x.com/jack/../status/20",
    "https://x.com/waytoolonghandle12345/status/20",
    "https://x.com/jack space/status/20",
    "https://api.x.com/jack/status/20",
    "https://publish.x.com/jack/status/20",
    "javascript:alert(1)",
    "//x.com/jack/status/20",
    `https://x.com/jack/status/${"1".repeat(400)}`,
  ];
  for (const url of bad) assert.equal(parseXPostUrl(url), null, url);
  assert.equal(parseXPostUrl(undefined as unknown as string), null);
  assert.equal(parseXPostUrl(42 as unknown as string), null);
});

test("the only URL fetched is publish.x.com/oembed with the canonical post URL", () => {
  const ref = parseXPostUrl("https://mobile.twitter.com/jack/status/20?s=1")!;
  assert.equal(
    oembedUrl(ref),
    "https://publish.x.com/oembed?url=https%3A%2F%2Fx.com%2Fjack%2Fstatus%2F20&omit_script=1",
  );
});

test("handleFromAuthorUrl reads x.com and twitter.com author URLs only", () => {
  assert.equal(handleFromAuthorUrl("https://x.com/jack"), "jack");
  assert.equal(handleFromAuthorUrl("https://twitter.com/jack"), "jack");
  assert.equal(handleFromAuthorUrl("https://www.twitter.com/jack/"), "jack");
  assert.equal(handleFromAuthorUrl("http://x.com/jack"), null);
  assert.equal(handleFromAuthorUrl("https://evil.com/jack"), null);
  assert.equal(handleFromAuthorUrl("https://x.com/jack/status/20"), null);
  assert.equal(handleFromAuthorUrl("https://x.com/"), null);
  assert.equal(handleFromAuthorUrl("https://x.com@evil.com/jack"), null);
  assert.equal(handleFromAuthorUrl(null), null);
  assert.equal(handleFromAuthorUrl(7), null);
});

// -------------------------------------------------------------------- codes

test("deriveCode is deterministic and has the XXXX-XXXX shape", () => {
  const bucket = bucketOf(NOW);
  const code = deriveCode(SECRET, WALLET, bucket);
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(deriveCode(SECRET, WALLET, bucket), code);
});

test("deriveCode changes with the wallet, the bucket and the secret", () => {
  const bucket = bucketOf(NOW);
  const code = deriveCode(SECRET, WALLET, bucket);
  assert.notEqual(deriveCode(SECRET, Keypair.random().publicKey(), bucket), code);
  assert.notEqual(deriveCode(SECRET, WALLET, bucket + 1), code);
  assert.notEqual(deriveCode("another-secret-not-real-9876543210", WALLET, bucket), code);
});

test("codes use the whole alphabet roughly evenly (no stuck bits)", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 400; i += 1) for (const ch of deriveCode(SECRET, WALLET, i).replace("-", "")) seen.add(ch);
  assert.equal(seen.size, 32);
});

test("the code is stable inside a 24h bucket and rotates at its edge", () => {
  const start = bucketOf(NOW) * BUCKET_MS;
  assert.equal(challengeFor(SECRET, WALLET, start).code, challengeFor(SECRET, WALLET, start + BUCKET_MS - 1).code);
  assert.notEqual(challengeFor(SECRET, WALLET, start).code, challengeFor(SECRET, WALLET, start + BUCKET_MS).code);
});

test("challengeFor builds the tweet text and the intent link", () => {
  const challenge = challengeFor(SECRET, WALLET, NOW);
  assert.equal(challenge.text, `Verifico mi cuenta en Kosmovia 🌌 kosmovia:${challenge.code}`);
  assert.equal(
    challenge.intentUrl,
    `https://x.com/intent/post?text=${encodeURIComponent(challenge.text)}`,
  );
  assert.equal(challenge.expiresAt, (bucketOf(NOW) + 2) * BUCKET_MS);
});

test("acceptedCodes holds the current and the previous bucket, nothing older", () => {
  const codes = acceptedCodes(SECRET, WALLET, NOW);
  const bucket = bucketOf(NOW);
  assert.deepEqual(codes, [deriveCode(SECRET, WALLET, bucket), deriveCode(SECRET, WALLET, bucket - 1)]);
  assert.ok(!codes.includes(deriveCode(SECRET, WALLET, bucket - 2)));
});

// --------------------------------------------------------------------- html

const OEMBED_HTML = (inner: string, name = "jack", handle = "jack") =>
  `<blockquote class="twitter-tweet"><p lang="en" dir="ltr">${inner}</p>&mdash; ${name} (@${handle}) <a href="https://x.com/${handle}/status/20?ref_src=twsrc%5Etfw">March 21, 2006</a></blockquote>\n\n`;

test("extractPostText strips tags, decodes entities and ignores the byline", () => {
  assert.equal(extractPostText(OEMBED_HTML("just setting up my twttr")), "just setting up my twttr");
  assert.equal(
    extractPostText(OEMBED_HTML('Hola <a href="https://t.co/x">pic.twitter.com/x</a><br>Tom &amp; Jerry &lt;3 &quot;hi&quot; &#39;yo&#x27;')),
    `Hola pic.twitter.com/x Tom & Jerry <3 "hi" 'yo'`,
  );
  // The display name lives outside the <p> and must not count as post text.
  assert.ok(!extractPostText(OEMBED_HTML("hola", "kosmovia:AAAA-BBBB")).includes("kosmovia"));
  // Entities are decoded once only.
  assert.equal(extractPostText("<p>&amp;lt;</p>"), "&lt;");
  assert.equal(extractPostText("<p>a&#0;b &unknown; &#x110000;</p>"), "a&#0;b &unknown; &#x110000;");
  assert.equal(extractPostText(undefined), "");
  assert.equal(extractPostText("no paragraphs here"), "");
});

test("textHasCode matches a standalone code, case-insensitive, and nothing else", () => {
  const code = deriveCode(SECRET, WALLET, bucketOf(NOW));
  assert.equal(textHasCode(`Verifico mi cuenta en Kosmovia 🌌 kosmovia:${code}`, [code]), true);
  assert.equal(textHasCode(`KOSMOVIA:${code.toLowerCase()}.`, [code]), true);
  assert.equal(textHasCode(`kosmovia:${code}`, [code]), true);
  assert.equal(textHasCode(`xkosmovia:${code}`, [code]), false);
  assert.equal(textHasCode(`kosmovia:${code}9`, [code]), false);
  assert.equal(textHasCode(`kosmovia: ${code}`, [code]), false);
  assert.equal(textHasCode(code, [code]), false);
  assert.equal(textHasCode("kosmovia:ZZZZ-ZZZZ", [code]), false);
  assert.equal(textHasCode("", [code]), false);
});

// ------------------------------------------------------------------- verify

type Call = { url: string; init: RequestInit };

function mockFetcher(respond: () => Response | Promise<Response>): { fetcher: Fetcher; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return respond();
    },
  };
}

function oembedResponse(overrides: Record<string, unknown> = {}, status = 200): Response {
  const code = deriveCode(SECRET, WALLET, bucketOf(NOW));
  const body = {
    url: "https://x.com/jack/status/20",
    author_name: "jack",
    author_url: "https://x.com/jack",
    html: OEMBED_HTML(`Verifico mi cuenta en Kosmovia 🌌 kosmovia:${code}`),
    ...overrides,
  };
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const POST_URL = "https://x.com/jack/status/20";
const base = { url: POST_URL, wallet: WALLET, secret: SECRET, now: NOW };

test("verifyXPost succeeds and fetches only the canonical oEmbed URL", async () => {
  const { fetcher, calls } = mockFetcher(() => oembedResponse());
  const result = await verifyXPost({ ...base, url: "https://mobile.twitter.com/jack/status/20?s=1", fetcher });
  assert.deepEqual(result, { ok: true, handle: "jack", verifiedAt: new Date(NOW).toISOString() });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://publish.x.com/oembed?url=https%3A%2F%2Fx.com%2Fjack%2Fstatus%2F20&omit_script=1");
  assert.equal(calls[0].init.redirect, "error");
  assert.ok(calls[0].init.signal);
});

test("verifyXPost never touches the network for a bad URL", async () => {
  const { fetcher, calls } = mockFetcher(() => oembedResponse());
  for (const url of ["https://x.com@evil.com/jack/status/20", "http://x.com/jack/status/20", "https://evil.com/a/status/1"]) {
    const result = await verifyXPost({ ...base, url, fetcher });
    assert.ok(!result.ok && result.code === "bad_url" && result.status === 400, url);
  }
  assert.equal(calls.length, 0);
});

test("verifyXPost uses the handle X reports, ignoring the URL's casing", async () => {
  const { fetcher } = mockFetcher(() => oembedResponse({ author_url: "https://twitter.com/Jack" }));
  const result = await verifyXPost({ ...base, fetcher });
  assert.ok(result.ok);
  assert.equal(result.handle, "Jack");
});

test("verifyXPost accepts the previous bucket's code, not the one before", async () => {
  const bucket = bucketOf(NOW);
  const html = (code: string) => OEMBED_HTML(`kosmovia:${code}`);
  const prev = mockFetcher(() => oembedResponse({ html: html(deriveCode(SECRET, WALLET, bucket - 1)) }));
  assert.ok((await verifyXPost({ ...base, fetcher: prev.fetcher })).ok);
  const old = mockFetcher(() => oembedResponse({ html: html(deriveCode(SECRET, WALLET, bucket - 2)) }));
  const result = await verifyXPost({ ...base, fetcher: old.fetcher });
  assert.ok(!result.ok && result.code === "code_missing" && result.status === 422);
});

test("verifyXPost: another wallet's code does not verify this wallet", async () => {
  const other = deriveCode(SECRET, Keypair.random().publicKey(), bucketOf(NOW));
  const { fetcher } = mockFetcher(() => oembedResponse({ html: OEMBED_HTML(`kosmovia:${other}`) }));
  const result = await verifyXPost({ ...base, fetcher });
  assert.ok(!result.ok && result.code === "code_missing");
});

test("verifyXPost: a code copied into the display name does not count", async () => {
  const code = deriveCode(SECRET, WALLET, bucketOf(NOW));
  const { fetcher } = mockFetcher(() =>
    oembedResponse({ html: OEMBED_HTML("hola", `kosmovia:${code}`) , author_name: `kosmovia:${code}` }),
  );
  const result = await verifyXPost({ ...base, fetcher });
  assert.ok(!result.ok && result.code === "code_missing");
});

test("verifyXPost: author must match the handle in the URL", async () => {
  const mismatches = [
    "https://x.com/someone_else",
    "https://x.com/jack/status/20",
    "https://evil.com/jack",
    "http://x.com/jack",
    "",
    undefined,
  ];
  for (const author_url of mismatches) {
    const { fetcher } = mockFetcher(() => oembedResponse({ author_url }));
    const result = await verifyXPost({ ...base, fetcher });
    assert.ok(!result.ok && result.code === "author_mismatch" && result.status === 422, String(author_url));
  }
});

test("verifyXPost maps 404 and 403 to not_found", async () => {
  for (const status of [404, 403]) {
    const { fetcher } = mockFetcher(() => new Response("{}", { status }));
    const result = await verifyXPost({ ...base, fetcher });
    assert.ok(!result.ok && result.code === "not_found" && result.status === 404, String(status));
  }
});

test("verifyXPost maps X failures to x_unreachable", async () => {
  const cases: Array<[string, () => Response | Promise<Response>]> = [
    ["500", () => new Response("oops", { status: 500 })],
    ["429", () => new Response("slow down", { status: 429 })],
    ["not json", () => new Response("<html>", { status: 200 })],
    ["json null", () => new Response("null", { status: 200 })],
    ["json string", () => new Response('"hi"', { status: 200 })],
    ["network error", () => Promise.reject(new TypeError("fetch failed"))],
    ["redirect refused", () => Promise.reject(new TypeError("redirect mode is set to error"))],
  ];
  for (const [name, respond] of cases) {
    const { fetcher } = mockFetcher(respond);
    const result = await verifyXPost({ ...base, fetcher });
    assert.ok(!result.ok && result.code === "x_unreachable" && result.status === 502, name);
  }
});

test("verifyXPost refuses an oversized response, declared or streamed", async () => {
  const huge = "x".repeat(2_000);
  const streamed = mockFetcher(() => oembedResponse({ html: huge }));
  const a = await verifyXPost({ ...base, fetcher: streamed.fetcher, maxBytes: 500 });
  assert.ok(!a.ok && a.code === "x_unreachable");

  const declared = mockFetcher(
    () => new Response("{}", { status: 200, headers: { "content-length": "99999999" } }),
  );
  const b = await verifyXPost({ ...base, fetcher: declared.fetcher });
  assert.ok(!b.ok && b.code === "x_unreachable");
});

test("verifyXPost times out a hanging oEmbed call", async () => {
  const hang: Fetcher = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  const result = await verifyXPost({ ...base, fetcher: hang, timeoutMs: 20 });
  assert.ok(!result.ok && result.code === "x_unreachable");
});

// ------------------------------------------------------------------- routes

const ORIGIN = "https://kosmovia.test";

function signedRequest(keypair: Keypair, path: string, body?: unknown): Request {
  const address = keypair.publicKey();
  const exp = Date.now() + 60_000;
  const payload = Buffer.concat([
    Buffer.from("Stellar Signed Message:\n", "utf8"),
    Buffer.from(authMessage(address, exp, "POST", path), "utf8"),
  ]);
  const signature = keypair.sign(createHash("sha256").update(payload).digest()).toString("base64");
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { [PROOF_HEADER]: JSON.stringify({ address, exp, signature }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function withSecret<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const before = process.env.X_CHALLENGE_SECRET;
  if (value === undefined) delete process.env.X_CHALLENGE_SECRET;
  else process.env.X_CHALLENGE_SECRET = value;
  return run().finally(() => {
    if (before === undefined) delete process.env.X_CHALLENGE_SECRET;
    else process.env.X_CHALLENGE_SECRET = before;
  });
}

test("routes demand a signed proof", async () => {
  for (const route of [challengeRoute, verifyRoute]) {
    const res = await route(new Request(`${ORIGIN}/api/x/challenge`, { method: "POST" }));
    assert.equal(res.status, 401);
  }
});

test("routes answer 503 in Spanish when X_CHALLENGE_SECRET is missing or too short", async () => {
  const keypair = Keypair.random();
  for (const value of [undefined, "", "short"]) {
    const res = await withSecret(value, () => challengeRoute(signedRequest(keypair, "/api/x/challenge")));
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: string; code: string };
    assert.equal(body.code, "secret_missing");
    assert.match(body.error, /X_CHALLENGE_SECRET/);
    const verify = await withSecret(value, () =>
      verifyRoute(signedRequest(keypair, "/api/x/verify", { url: POST_URL })),
    );
    assert.equal(verify.status, 503);
  }
});

test("challenge route returns the code of the signed wallet only", async () => {
  const keypair = Keypair.random();
  const res = await withSecret(SECRET, () => challengeRoute(signedRequest(keypair, "/api/x/challenge")));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { code: string; text: string; intentUrl: string };
  assert.equal(body.code, deriveCode(SECRET, keypair.publicKey(), bucketOf(Date.now())));
  assert.ok(body.intentUrl.startsWith("https://x.com/intent/post?text="));
});

test("verify route rejects a missing, malformed or oversized body without touching X", async () => {
  const keypair = Keypair.random();
  for (const body of [undefined, {}, { url: 5 }, { url: "x".repeat(5_000) }]) {
    const res = await withSecret(SECRET, () => verifyRoute(signedRequest(keypair, "/api/x/verify", body)));
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { code: string }).code, "bad_url");
  }
  const res = await withSecret(SECRET, () =>
    verifyRoute(signedRequest(keypair, "/api/x/verify", { url: "https://evil.com/a/status/1" })),
  );
  assert.equal(res.status, 400);
});
