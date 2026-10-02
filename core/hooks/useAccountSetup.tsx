"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePollar } from "@pollar/react";
import { signedFetch } from "../lib/auth-client.ts";
import { usePollarStatus } from "../lib/pollar.tsx";

export type SetupStatus =
  | { step: "idle" }
  | { step: "working"; message: string }
  | { step: "done" }
  | { step: "error"; message: string };

type SetupContextValue = { status: SetupStatus; retry: () => void };

const SetupContext = createContext<SetupContextValue>({ status: { step: "idle" }, retry: () => {} });

/** Progress of "create account + USDC trustline, sponsored". Safe anywhere under <Providers>. */
export function useAccountSetup(): SetupContextValue {
  return useContext(SetupContext);
}

/** Mounts the runner only when Pollar exists, because the runner calls usePollar(). */
export function AccountSetupProvider({ children }: { children: ReactNode }) {
  const pollar = usePollarStatus();
  if (!pollar.configured) return <>{children}</>;
  return <Runner>{children}</Runner>;
}

function Runner({ children }: { children: ReactNode }) {
  const { isAuthenticated, verified, wallet, getClient, refreshAssets, refreshWalletBalance, setTrustline } =
    usePollar();
  const [status, setStatus] = useState<SetupStatus>({ step: "idle" });
  const startedFor = useRef<string | null>(null);

  const run = useCallback(async () => {
    if (!wallet) return;
    const client = getClient();
    try {
      // Smart accounts (passkey) are deployed already sponsored by Pollar and are not offered at login yet.
      if (wallet.custody === "smart") {
        setStatus({ step: "done" });
        return;
      }

      // 1. Account. External wallets (Freighter): sponsored createAccount that the
      //    user co-signs. Custodial wallets are created on the server at login,
      //    except in DEFERRED funding mode, where our backend must call fund.
      if (wallet.custody === "external" && wallet.existsOnStellar === false) {
        if (wallet.fundingMode === "DEFERRED") {
          setStatus({
            step: "error",
            message: "La app de Pollar está en modo diferido: la cuenta de Freighter no se crea sola. Usa Recargar XLM de prueba en Wallet.",
          });
          return;
        }
        setStatus({ step: "working", message: "Creando tu cuenta en testnet (confirma en Freighter)…" });
        const created = await client.createAccount();
        if (created.status === "error") {
          setStatus({ step: "error", message: created.details ?? "No se pudo crear la cuenta." });
          return;
        }
      } else if (wallet.custody === "internal" && wallet.fundingMode === "DEFERRED" && wallet.existsOnStellar === false) {
        setStatus({ step: "working", message: "Activando tu cuenta…" });
        const res = await signedFetch(client, wallet.address, "/api/wallet/fund", { method: "POST" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setStatus({ step: "error", message: body.error ?? "No se pudo activar la cuenta." });
          return;
        }
      }

      // 2. Trustlines for the assets the app enabled in the Pollar dashboard (USDC).
      setStatus({ step: "working", message: "Preparando USDC en tu cuenta…" });
      await refreshAssets();
      const state = client.getEnabledAssetsState();
      if (state.step === "loaded") {
        const pending = state.data.assets.filter(
          (a) => a.type !== "native" && a.issuer && a.trustlineEstablished === false,
        );
        for (const asset of pending) {
          const out = await setTrustline({ code: asset.code, issuer: asset.issuer as string });
          if (out.status === "error") {
            setStatus({ step: "error", message: out.details ?? `No se pudo habilitar ${asset.code}.` });
            return;
          }
        }
        if (pending.length > 0) await refreshAssets();
      }
      await refreshWalletBalance();
      setStatus({ step: "done" });
    } catch (err) {
      setStatus({ step: "error", message: err instanceof Error ? err.message : "Falló la preparación de la cuenta." });
    }
  }, [wallet, getClient, refreshAssets, refreshWalletBalance, setTrustline]);

  useEffect(() => {
    if (!isAuthenticated || !verified || !wallet) {
      startedFor.current = null;
      setStatus({ step: "idle" });
      return;
    }
    if (startedFor.current === wallet.address) return;
    startedFor.current = wallet.address;
    void run();
  }, [isAuthenticated, verified, wallet, run]);

  const retry = useCallback(() => {
    void run();
  }, [run]);

  const value = useMemo(() => ({ status, retry }), [status, retry]);
  return <SetupContext.Provider value={value}>{children}</SetupContext.Provider>;
}
