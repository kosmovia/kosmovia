"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { usePollar } from "@pollar/react";
import { PollarGate } from "../lib/pollar.tsx";
import { usePollarAuth } from "../hooks/usePollarAuth.ts";
import { signedFetch } from "../lib/auth-client.ts";

/** Card "Conectar X" on /perfil: get a code, post it on X, paste the link, verify. */
export function XVerifyCard() {
  return (
    <PollarGate>
      <XVerifyInner />
    </PollarGate>
  );
}

type Challenge = { code: string; text: string; intentUrl: string; expiresAt: number };
type Verified = { handle: string; verifiedAt: string };
type Notice = { kind: "error" | "info"; text: string } | null;
type CallResult<T> = { ok: true; data: T } | { ok: false; message: string };

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <path d="M7.5 12.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XVerifyInner() {
  const { user, isLoading } = usePollarAuth();
  const { getClient } = usePollar();
  const address = user?.address ?? null;

  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"challenge" | "verify" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [verified, setVerified] = useState<Verified | null>(null);
  const [copied, setCopied] = useState(false);

  async function call<T>(path: string, body?: unknown): Promise<CallResult<T>> {
    if (!address) return { ok: false, message: "Entra con tu wallet para continuar." };
    try {
      const res = await signedFetch(getClient(), address, path, {
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) return { ok: false, message: data.error ?? "Algo salió mal. Intenta de nuevo." };
      return { ok: true, data };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "No se pudo firmar la sesión." };
    }
  }

  async function getCode() {
    setBusy("challenge");
    setNotice(null);
    const res = await call<Challenge>("/api/x/challenge");
    setBusy(null);
    if (!res.ok) return setNotice({ kind: "error", text: res.message });
    setChallenge(res.data);
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!url.trim()) return setNotice({ kind: "error", text: "Pega el link de tu publicación en X." });
    setBusy("verify");
    setNotice(null);
    const res = await call<Verified>("/api/x/verify", { url: url.trim() });
    setBusy(null);
    if (!res.ok) return setNotice({ kind: "error", text: res.message });
    setVerified(res.data);
  }

  async function copyCode() {
    if (!challenge) return;
    try {
      await navigator.clipboard.writeText(`kosmovia:${challenge.code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const explainer = (
    <p className="muted" style={{ margin: 0, fontSize: "0.875rem" }}>
      Verificar demuestra que controlas esa cuenta de X. El check azul de X por sí solo no prueba tu identidad: solo
      indica que la cuenta paga X Premium.
    </p>
  );

  if (!user || !address) {
    return (
      <section className="card" style={{ display: "grid", gap: "0.75rem" }} aria-labelledby="x-title">
        <h2 id="x-title" style={{ margin: 0, fontSize: "1.1rem" }}>Conectar X</h2>
        <p className="muted" style={{ margin: 0 }}>
          {isLoading ? "Conectando…" : "Entra para conectar tu cuenta de X."}
        </p>
        {!isLoading && (
          <div>
            <Link href="/" className="btn btn-primary">Entrar</Link>
          </div>
        )}
      </section>
    );
  }

  if (verified) {
    return (
      <section className="card" style={{ display: "grid", gap: "0.75rem" }} aria-labelledby="x-title">
        <h2 id="x-title" style={{ margin: 0, fontSize: "1.1rem" }}>Conectar X</h2>
        <p role="status" style={{ margin: 0, display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--glow)" }}>
          <CheckIcon />
          <span>
            <strong>@{verified.handle}</strong> verificado
          </span>
        </p>
        {explainer}
      </section>
    );
  }

  return (
    <section className="card" style={{ display: "grid", gap: "1rem" }} aria-labelledby="x-title">
      <h2 id="x-title" style={{ margin: 0, fontSize: "1.1rem" }}>Conectar X</h2>
      {explainer}

      <div style={{ display: "grid", gap: "0.5rem" }}>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>1. Obtén tu código</h3>
        {challenge ? (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <code style={{ fontSize: "1.05rem" }}>kosmovia:{challenge.code}</code>
            <button type="button" className="btn" onClick={copyCode}>
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
        ) : (
          <div>
            <button type="button" className="btn btn-primary" onClick={getCode} disabled={busy !== null}>
              {busy === "challenge" ? "Generando…" : "Obtener código"}
            </button>
          </div>
        )}
      </div>

      {challenge && (
        <>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            <h3 style={{ margin: 0, fontSize: "1rem" }}>2. Publícalo en X</h3>
            <p className="muted" style={{ margin: 0, fontSize: "0.875rem" }}>
              Se abre X con el texto listo. Publícalo desde la cuenta que quieres conectar y no lo borres.
            </p>
            <div>
              <a className="btn btn-primary" href={challenge.intentUrl} target="_blank" rel="noreferrer">
                Publicar en X
              </a>
            </div>
          </div>

          <form onSubmit={verify} style={{ display: "grid", gap: "0.5rem" }} noValidate>
            <h3 style={{ margin: 0, fontSize: "1rem" }}>3. Pega el link de tu publicación</h3>
            <div className="field">
              <label htmlFor="x-post-url">Link de la publicación</label>
              <input
                id="x-post-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://x.com/tu_usuario/status/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-invalid={notice?.kind === "error" ? true : undefined}
                aria-describedby="x-status"
              />
            </div>
            <div>
              <button type="submit" className="btn btn-primary" disabled={busy !== null}>
                {busy === "verify" ? "Verificando…" : "Verificar"}
              </button>
            </div>
          </form>
        </>
      )}

      <div id="x-status" aria-live="polite" role="status">
        {notice && (
          <p className={notice.kind === "error" ? "error" : "muted"} style={{ margin: 0 }}>
            {notice.text}
          </p>
        )}
      </div>
    </section>
  );
}
