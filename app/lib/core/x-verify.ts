import { createHmac } from "node:crypto";

/**
 * Free X (Twitter) account verification, no X API key (docs/ARQUITECTURA.md
 * section 5). Server-only; plain functions so `node --test` can run them.
 *
 * 1. The server derives a short code from the wallet (stateless HMAC).
 * 2. The user posts it on X and pastes the post URL.
 * 3. We ask X's public oEmbed endpoint for that one post and check that the
 *    post's author owns the URL handle and that the post text holds the code.
 *
 * SSRF safety: the only host we ever fetch is `publish.x.com`, and the target
 * URL is rebuilt from the validated `{handle, id}`, never forwarded as typed.
 */

// ---------------------------------------------------------------- challenge

/** A code is valid for the bucket it was issued in and the next one (24h to 48h). */
export const BUCKET_MS = 24 * 60 * 60 * 1000;
export const MIN_SECRET_LENGTH = 16;
export const CODE_PREFIX = "kosmovia:";

/** Crockford base32: no I, L, O or U, so a code can be read aloud or retyped. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function bucketOf(now: number): number {
  return Math.floor(now / BUCKET_MS);
}

/** `XXXX-XXXX`: 40 bits of HMAC-SHA256(secret, wallet + bucket). */
export function deriveCode(secret: string, wallet: string, bucket: number): string {
  const mac = createHmac("sha256", secret).update(`kosmovia-x:v1:${wallet}:${bucket}`).digest();
  // 5 bytes = 40 bits = 8 symbols of 5 bits. Plain numbers (no BigInt: the target is ES2017).
  let out = "";
  let buffer = 0;
  let held = 0;
  for (let i = 0; i < 5; i += 1) {
    buffer = (buffer << 8) | mac[i];
    held += 8;
    while (held >= 5) {
      held -= 5;
      out += ALPHABET[(buffer >> held) & 31];
    }
    buffer &= (1 << held) - 1;
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** The text the user should post, with the code in it. */
export function tweetText(code: string): string {
  return `Verifico mi cuenta en Kosmovia 🌌 ${CODE_PREFIX}${code}`;
}

export function intentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

export type Challenge = { code: string; text: string; intentUrl: string; expiresAt: number };

/** Current code for a wallet, ready for the UI. `expiresAt` is when the last bucket that still accepts it ends. */
export function challengeFor(secret: string, wallet: string, now: number): Challenge {
  const bucket = bucketOf(now);
  const code = deriveCode(secret, wallet, bucket);
  const text = tweetText(code);
  return { code, text, intentUrl: intentUrl(text), expiresAt: (bucket + 2) * BUCKET_MS };
}

/** Codes accepted right now: the current bucket's and the previous one's. */
export function acceptedCodes(secret: string, wallet: string, now: number): string[] {
  const bucket = bucketOf(now);
  return [deriveCode(secret, wallet, bucket), deriveCode(secret, wallet, bucket - 1)];
}

// ---------------------------------------------------------------------- URLs

const X_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
]);
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const STATUS_ID = /^[0-9]{1,20}$/;
const MAX_URL_LENGTH = 300;

export type XPostRef = { handle: string; id: string; canonicalUrl: string };

/**
 * Accepts only `https://{x.com|twitter.com}/{handle}/status/{digits}` (also
 * www./mobile., optional trailing slash, query and hash ignored). Anything
 * else (http, userinfo, ports, other hosts, extra path, non-digit ids) is null.
 */
export function parseXPostUrl(input: string): XPostRef | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > MAX_URL_LENGTH) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password || url.port) return null;
  if (!X_HOSTS.has(url.hostname)) return null;
  // Backslashes and encoded separators are how host/path tricks hide.
  if (raw.includes("\\") || /%(2f|5c|40)/i.test(url.pathname)) return null;

  const segments = url.pathname.replace(/\/$/, "").split("/");
  // ["", handle, "status", id]
  if (segments.length !== 4 || segments[0] !== "" || segments[2] !== "status") return null;
  const [, handle, , id] = segments;
  if (!HANDLE.test(handle) || handle.toLowerCase() === "i") return null;
  if (!STATUS_ID.test(id)) return null;

  return { handle, id, canonicalUrl: `https://x.com/${handle}/status/${id}` };
}

/** The only URL this module ever fetches. */
export function oembedUrl(ref: XPostRef): string {
  return `https://publish.x.com/oembed?url=${encodeURIComponent(ref.canonicalUrl)}&omit_script=1`;
}

/** `https://x.com/{handle}` (or twitter.com, www., mobile.) to the handle, else null. */
export function handleFromAuthorUrl(authorUrl: unknown): string | null {
  if (typeof authorUrl !== "string" || authorUrl.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(authorUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (!X_HOSTS.has(url.hostname)) return null;
  const segments = url.pathname.replace(/\/$/, "").split("/");
  if (segments.length !== 2 || segments[0] !== "") return null;
  return HANDLE.test(segments[1]) ? segments[1] : null;
}

// ---------------------------------------------------------------- oEmbed html

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  // One pass, so "&amp;lt;" becomes "&lt;" and not "<".
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Text of the post only: the `<p>` paragraphs of the oEmbed blockquote.
 * The trailing "- Display Name (@handle) date" line is left out on purpose,
 * since the display name is user-chosen and could carry a copied code.
 */
export function extractPostText(html: unknown): string {
  if (typeof html !== "string") return "";
  const paragraphs: string[] = [];
  for (const match of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const inner = match[1].replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "");
    paragraphs.push(decodeEntities(inner));
  }
  return paragraphs.join(" ").replace(/\s+/g, " ").trim();
}

/** Whether `text` has one of `codes` as a standalone `kosmovia:XXXX-XXXX` token (case-insensitive). */
export function textHasCode(text: string, codes: string[]): boolean {
  const wanted = new Set(codes.map((c) => c.toUpperCase()));
  const found = /(?:^|[^0-9a-z])kosmovia:([0-9a-z]{4}-[0-9a-z]{4})(?![0-9a-z])/gi;
  for (const match of text.matchAll(found)) {
    if (wanted.has(match[1].toUpperCase())) return true;
  }
  return false;
}

// -------------------------------------------------------------------- verify

export const OEMBED_TIMEOUT_MS = 8_000;
export const OEMBED_MAX_BYTES = 64 * 1024;

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export type VerifyErrorCode = "bad_url" | "not_found" | "code_missing" | "author_mismatch" | "x_unreachable";

export type VerifyResult =
  | { ok: true; handle: string; verifiedAt: string }
  | { ok: false; code: VerifyErrorCode; status: number; error: string };

export const VERIFY_ERRORS: Record<VerifyErrorCode, { status: number; error: string }> = {
  bad_url: {
    status: 400,
    error: "Ese link no es de una publicación de X. Debe verse como https://x.com/tu_usuario/status/123…",
  },
  not_found: {
    status: 404,
    error: "No encontramos esa publicación. Revisa que sea pública y que el link sea correcto.",
  },
  code_missing: {
    status: 422,
    error: "La publicación no contiene tu código vigente. Publica el texto tal cual y pega el link nuevo.",
  },
  author_mismatch: {
    status: 422,
    error: "El autor de la publicación no coincide con la cuenta del link.",
  },
  x_unreachable: {
    status: 502,
    error: "No pudimos consultar X ahora mismo. Intenta de nuevo en un momento.",
  },
};

function failure(code: VerifyErrorCode): VerifyResult {
  return { ok: false, code, ...VERIFY_ERRORS[code] };
}

/** Reads at most `max` bytes; null if the body is larger. */
async function readLimited(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export type VerifyOptions = {
  url: string;
  wallet: string;
  secret: string;
  now?: number;
  /** Inject in tests: no real network. Defaults to global `fetch`. */
  fetcher?: Fetcher;
  timeoutMs?: number;
  maxBytes?: number;
};

/**
 * Checks that the post at `url` was written by the handle in the URL and
 * contains this wallet's code. Never throws: every failure is a `VerifyResult`.
 */
export async function verifyXPost(opts: VerifyOptions): Promise<VerifyResult> {
  const ref = parseXPostUrl(opts.url);
  if (!ref) return failure("bad_url");

  const now = opts.now ?? Date.now();
  const fetcher: Fetcher = opts.fetcher ?? ((url, init) => fetch(url, init));

  let body: string | null;
  try {
    const res = await fetcher(oembedUrl(ref), {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      // A redirect could point anywhere: fail closed instead of following it.
      redirect: "error",
      signal: AbortSignal.timeout(opts.timeoutMs ?? OEMBED_TIMEOUT_MS),
    });
    // oEmbed answers 404 for a missing post and 403 for a protected one.
    if (res.status === 404 || res.status === 403) return failure("not_found");
    if (!res.ok) return failure("x_unreachable");
    body = await readLimited(res, opts.maxBytes ?? OEMBED_MAX_BYTES);
  } catch {
    return failure("x_unreachable");
  }
  if (body === null) return failure("x_unreachable");

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return failure("x_unreachable");
  }
  if (!data || typeof data !== "object") return failure("x_unreachable");
  const { author_url: authorUrl, html } = data as { author_url?: unknown; html?: unknown };

  const authorHandle = handleFromAuthorUrl(authorUrl);
  if (!authorHandle || authorHandle.toLowerCase() !== ref.handle.toLowerCase()) {
    return failure("author_mismatch");
  }

  const text = extractPostText(html);
  if (!textHasCode(text, acceptedCodes(opts.secret, opts.wallet, now))) return failure("code_missing");

  return { ok: true, handle: authorHandle, verifiedAt: new Date(now).toISOString() };
}
