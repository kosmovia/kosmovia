"use client";

import { createContext, useContext, type ReactNode } from "react";
import { PollarClient } from "@pollar/core";
import { PollarProvider } from "@pollar/react";
import { NETWORK, readPublishableKey } from "./pollar-config.ts";
import "@pollar/react/styles.css";

/**
 * Exactly ONE PollarClient, kept on globalThis so it survives React StrictMode
 * double-initialization and dev hot reloads. Two live clients share one
 * persisted session and refresh independently; the single-use refresh-token
 * rotation then trips the server's reuse detection and logs the user out.
 */
const globalPollar = globalThis as { __kosmoviaPollarClient?: PollarClient };

function getPollarClient(key: string): PollarClient {
  globalPollar.__kosmoviaPollarClient ??= new PollarClient({
    apiKey: key,
    stellarNetwork: NETWORK,
  });
  return globalPollar.__kosmoviaPollarClient;
}

type PollarStatus = { configured: true } | { configured: false; message: string };

const PollarStatusContext = createContext<PollarStatus>({
  configured: false,
  message: "Pollar no está inicializado.",
});

/** Whether Pollar is available, and why not. Safe to call anywhere under <PollarAppProvider>. */
export function usePollarStatus(): PollarStatus {
  return useContext(PollarStatusContext);
}

/**
 * Single place where Pollar is initialized (mounted from components/Providers).
 * Without a valid publishable key it does NOT crash: it renders the children
 * with `configured: false`, and every Pollar-dependent component shows
 * <PollarMissing /> instead of calling usePollar() (which would throw outside
 * a provider).
 */
export function PollarAppProvider({ children }: { children: ReactNode }) {
  const status = readPublishableKey();
  if (!status.ok) {
    return (
      <PollarStatusContext.Provider value={{ configured: false, message: status.message }}>
        {children}
      </PollarStatusContext.Provider>
    );
  }
  return (
    <PollarStatusContext.Provider value={{ configured: true }}>
      <PollarProvider client={getPollarClient(status.key)}>{children}</PollarProvider>
    </PollarStatusContext.Provider>
  );
}

/** Clear Spanish notice shown where Pollar can't run. */
export function PollarMissing({ compact = false }: { compact?: boolean }) {
  const status = usePollarStatus();
  const message = status.configured ? "" : status.message;
  if (compact) return <span className="muted">{message}</span>;
  return (
    <div className="card" role="alert">
      <p className="error" style={{ margin: 0 }}>
        {message}
      </p>
      <p className="muted" style={{ margin: "0.5rem 0 0" }}>
        Copia core/.env.example a core/.env.local y pega la clave publicable de dashboard.pollar.xyz
        (Build, API Keys). Es de testnet y es segura para el navegador.
      </p>
    </div>
  );
}

/**
 * Renders `children` only when Pollar is configured, so those children can use
 * usePollar() safely; otherwise renders the notice (or `fallback`).
 */
export function PollarGate({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const status = usePollarStatus();
  if (!status.configured) return <>{fallback ?? <PollarMissing />}</>;
  return <>{children}</>;
}
