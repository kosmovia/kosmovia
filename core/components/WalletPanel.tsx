"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PollarGate } from "../lib/pollar.tsx";
import { usePollarAuth } from "../hooks/usePollarAuth.ts";
import { useAccountSetup } from "../hooks/useAccountSetup.tsx";
import {
  FRIENDBOT_URL,
  USDC_FAUCET_URL,
  explorerAccountUrl,
} from "../lib/pollar-config.ts";
import {
  fetchBalances,
  formatAmount,
  requestFriendbot,
  type AccountBalances,
} from "../lib/pollar-horizon.ts";

/** /wallet: address, XLM and USDC balances (Horizon testnet), explorer link and test-funds helpers. */
export function WalletPanel() {
  return (
    <PollarGate>
      <WalletInner />
    </PollarGate>
  );
}

type Load =
  | { step: "loading" }
  | { step: "ready"; balances: AccountBalances }
  | { step: "error"; message: string };

function WalletInner() {
  const { user, isLoading } = usePollarAuth();
  const { status: setup } = useAccountSetup();
  const address = user?.address ?? null;

  const [load, setLoad] = useState<Load>({ step: "loading" });
  const [copied, setCopied] = useState(false);
  const [faucet, setFaucet] = useState<{ busy: boolean; message: string | null; ok: boolean }>({
    busy: false,
    message: null,
    ok: false,
  });

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!address) return;
      setLoad({ step: "loading" });
      try {
        setLoad({ step: "ready", balances: await fetchBalances(address, signal) });
      } catch (err) {
        if (signal?.aborted) return;
        setLoad({
          step: "error",
          message: err instanceof Error ? err.message : "No se pudo leer el saldo.",
        });
      }
    },
    [address],
  );

  // Reload when the address changes and when the account setup finishes (the trustline lands on-chain).
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh, setup.step]);

  async function copy() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  async function fundXlm() {
    if (!address) return;
    setFaucet({ busy: true, message: null, ok: false });
    const res = await requestFriendbot(address, FRIENDBOT_URL);
    setFaucet({
      busy: false,
      ok: res.ok,
      message: res.ok ? "Listo: recibiste XLM de prueba." : res.message,
    });
    if (res.ok) void refresh();
  }

  if (!user || !address) {
    return (
      <div className="card">
        <p style={{ marginTop: 0 }} className="muted">
          {isLoading ? "Conectando…" : "Entra para ver tu wallet."}
        </p>
        {!isLoading && (
          <Link href="/" className="btn btn-primary">
            Entrar
          </Link>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div className="card" style={{ display: "grid", gap: "0.5rem" }}>
        <span className="muted">Tu dirección (testnet)</span>
        <code style={{ wordBreak: "break-all" }}>{address}</code>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={copy}>
            {copied ? "Copiada" : "Copiar dirección"}
          </button>
          <a className="btn" href={explorerAccountUrl(address)} target="_blank" rel="noreferrer">
            Ver en stellar.expert
          </a>
        </div>
      </div>

      <div className="card" style={{ display: "grid", gap: "0.5rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Saldo</h2>
        {load.step === "loading" && <p className="muted" style={{ margin: 0 }}>Cargando saldo…</p>}
        {load.step === "error" && (
          <p className="error" role="alert" style={{ margin: 0 }}>
            No pudimos leer el saldo ({load.message}).{" "}
            <button type="button" className="btn btn-ghost" onClick={() => void refresh()}>
              Reintentar
            </button>
          </p>
        )}
        {load.step === "ready" && !load.balances.exists && (
          <p className="muted" style={{ margin: 0 }}>
            Tu cuenta todavía no existe en la red de prueba. Si recién entraste, espera unos segundos; si no
            aparece, pulsa Recargar XLM de prueba.
          </p>
        )}
        {load.step === "ready" && load.balances.exists && (
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.25rem 1rem" }}>
            <dt className="muted">XLM</dt>
            <dd style={{ margin: 0 }}>{formatAmount(load.balances.xlm)}</dd>
            <dt className="muted">USDC</dt>
            <dd style={{ margin: 0 }}>
              {load.balances.usdc === null ? (
                <span className="muted">sin habilitar todavía</span>
              ) : (
                formatAmount(load.balances.usdc)
              )}
            </dd>
          </dl>
        )}
        {setup.step === "working" && <p className="muted" style={{ margin: 0 }}>{setup.message}</p>}
        {setup.step === "error" && (
          <p className="error" role="alert" style={{ margin: 0 }}>
            {setup.message}
          </p>
        )}
      </div>

      <div className="card" style={{ display: "grid", gap: "0.5rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Fondos de prueba</h2>
        <p className="muted" style={{ margin: 0 }}>
          Solo testnet: estos fondos no tienen valor real.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={fundXlm} disabled={faucet.busy}>
            {faucet.busy ? "Pidiendo…" : "Recargar XLM de prueba"}
          </button>
          <a className="btn" href={USDC_FAUCET_URL} target="_blank" rel="noreferrer">
            USDC de prueba (faucet.circle.com)
          </a>
        </div>
        {faucet.message && (
          <p className={faucet.ok ? "muted" : "error"} role="status" style={{ margin: 0 }}>
            {faucet.message}
          </p>
        )}
        <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
          En faucet.circle.com elige Stellar y testnet, y pega tu dirección.
        </p>
      </div>
    </div>
  );
}
