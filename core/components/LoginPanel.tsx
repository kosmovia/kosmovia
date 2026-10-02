"use client";

import Link from "next/link";
import { PollarGate } from "../lib/pollar.tsx";
import { usePollarAuth } from "../hooks/usePollarAuth.ts";
import { useAccountSetup } from "../hooks/useAccountSetup.tsx";
import { useServerSession } from "../hooks/useServerSession.ts";
import { shortAddress } from "../lib/pollar-horizon.ts";

/** Login screen: Google, email (Pollar modal) and Freighter. */
export function LoginPanel() {
  return (
    <PollarGate>
      <LoginInner />
    </PollarGate>
  );
}

function LoginInner() {
  const { user, isLoading, error, verified, loginGoogle, loginEmail, loginFreighter } = usePollarAuth();
  const { status: setup, retry: retrySetup } = useAccountSetup();
  const { session, retry: retrySession } = useServerSession(user?.address ?? null, verified);

  if (user) {
    return (
      <div className="card" style={{ display: "grid", gap: "0.75rem" }}>
        <p style={{ margin: 0 }}>
          Sesión iniciada como <strong title={user.address}>{shortAddress(user.address)}</strong>
        </p>

        {setup.step === "working" && <p className="muted" style={{ margin: 0 }}>{setup.message}</p>}
        {setup.step === "error" && (
          <p className="error" role="alert" style={{ margin: 0 }}>
            {setup.message}{" "}
            <button type="button" className="btn btn-ghost" onClick={retrySetup}>
              Reintentar
            </button>
          </p>
        )}
        {setup.step === "done" && (
          <p className="muted" style={{ margin: 0 }}>Tu cuenta de testnet está lista, con USDC habilitado.</p>
        )}

        {session.step === "checking" && <p className="muted" style={{ margin: 0 }}>Verificando tu sesión con el servidor…</p>}
        {session.step === "ok" && <p className="muted" style={{ margin: 0 }}>Sesión verificada en el servidor.</p>}
        {session.step === "error" && (
          <p className="error" role="alert" style={{ margin: 0 }}>
            {session.message}{" "}
            <button type="button" className="btn btn-ghost" onClick={retrySession}>
              Reintentar
            </button>
          </p>
        )}

        <div>
          <Link href="/wallet" className="btn btn-primary">
            Ir a mi wallet
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ display: "grid", gap: "0.75rem" }}>
      <button type="button" className="btn btn-primary" onClick={loginGoogle} disabled={isLoading}>
        Entrar con Google
      </button>
      <button type="button" className="btn" onClick={loginEmail} disabled={isLoading}>
        Entrar con email
      </button>
      <button type="button" className="btn" onClick={loginFreighter} disabled={isLoading}>
        Conectar Freighter
      </button>
      {isLoading && <p className="muted" style={{ margin: 0 }}>Conectando…</p>}
      {error && (
        <p className="error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
        Todo corre en testnet: no hay dinero real. Con Google o email, Pollar crea tu wallet; con Freighter,
        la clave sigue siendo tuya.
      </p>
    </div>
  );
}
