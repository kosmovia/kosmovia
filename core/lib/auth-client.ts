"use client";

import type { PollarClient } from "@pollar/core";
import { authMessage, normalizeRoute, PROOF_HEADER } from "./auth-message.ts";

type CachedProof = { address: string; exp: number; signature: string };

/**
 * One cached signature per (account, endpoint). The signature is bound to the
 * endpoint, so caching per endpoint keeps it from turning into a wallet popup
 * (Freighter) on every request.
 */
const cache = new Map<string, CachedProof>();

/** Comfortably under the server's 3-minute ceiling, even with clock drift. */
const PROOF_TTL_MS = 2 * 60 * 1000;

async function proofFor(
  client: PollarClient,
  address: string,
  method: string,
  path: string,
): Promise<CachedProof> {
  const key = `${address}|${method} ${normalizeRoute(path)}`;
  const hit = cache.get(key);
  if (hit && hit.exp - 30_000 > Date.now()) return hit;

  const exp = Date.now() + PROOF_TTL_MS;
  const signed = await client.stellar.sep53.signMessage(authMessage(address, exp, method, path));
  if (signed.status !== "signed") {
    throw new Error(signed.details ?? "No se pudo firmar la sesión");
  }

  const proof: CachedProof = {
    address: signed.signerAddress || address,
    exp,
    signature: signed.signature,
  };
  cache.set(key, proof);
  return proof;
}

/** Forgets cached proofs (call on logout). */
export function clearProofCache(): void {
  cache.clear();
}

/** `fetch()` that attaches a SEP-53 proof of the logged-in address for our own API routes. */
export async function signedFetch(
  client: PollarClient,
  address: string,
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  // Only the path is signed: a query string never decides a route here.
  const path = new URL(input, window.location.origin).pathname;

  const proof = await proofFor(client, address, method, path);
  const headers = new Headers(init.headers);
  headers.set(PROOF_HEADER, JSON.stringify(proof));
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(input, { ...init, headers });
}
