"use client";

import Link from "next/link";
import { PollarGate, usePollarStatus } from "../lib/pollar.tsx";
import { usePollarAuth } from "../hooks/usePollarAuth.ts";
import { shortAddress } from "../lib/pollar-horizon.ts";

/** Right slot of the header: short address + "Salir", or a link to log in. */
export function LoginHeaderSession() {
  const status = usePollarStatus();
  return (
    <PollarGate
      fallback={
        <Link href="/" className="muted" title={status.configured ? "" : status.message}>
          Pollar sin configurar
        </Link>
      }
    >
      <SessionInner />
    </PollarGate>
  );
}

function SessionInner() {
  const { user, logout } = usePollarAuth();
  if (!user) {
    return (
      <Link href="/" className="btn btn-ghost">
        Entrar
      </Link>
    );
  }
  return (
    <>
      <Link href="/wallet" className="muted" title={user.address}>
        {shortAddress(user.address)}
      </Link>
      <button type="button" className="btn btn-ghost" onClick={logout}>
        Salir
      </button>
    </>
  );
}
