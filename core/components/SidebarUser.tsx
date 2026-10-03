"use client";

import Link from "next/link";
import { Avatar } from "./Avatar";
import { PollarGate, usePollarStatus } from "../lib/pollar.tsx";
import { usePollarAuth } from "../hooks/usePollarAuth.ts";
import { useProfile } from "../hooks/useProfile.ts";
import { shortAddress } from "../lib/pollar-horizon.ts";

/** Pie fijo del sidebar de escritorio: avatar + sesión, o "Entrar". */
export function SidebarUser() {
  const status = usePollarStatus();
  return (
    <PollarGate
      fallback={
        <Link href="/" className="sidebar-user" title={status.configured ? "" : status.message}>
          <span className="sidebar-user-info">
            <span className="sidebar-user-name">Entrar</span>
          </span>
        </Link>
      }
    >
      <SidebarUserInner />
    </PollarGate>
  );
}

function SidebarUserInner() {
  const { user, logout } = usePollarAuth();
  const { profile } = useProfile();

  if (!user) {
    return (
      <Link href="/" className="sidebar-user">
        <span className="sidebar-user-info">
          <span className="sidebar-user-name">Entrar</span>
        </span>
      </Link>
    );
  }

  return (
    <div className="sidebar-user">
      <Avatar seed={profile?.avatarSeed || user.address} style={profile?.avatarStyle} size={32} username={profile?.username} />
      <div className="sidebar-user-info">
        <Link href="/wallet" className="sidebar-user-name" title={user.address}>
          {profile?.username ? `@${profile.username}` : shortAddress(user.address)}
        </Link>
        <button type="button" className="sidebar-user-logout" onClick={logout}>
          Salir
        </button>
      </div>
    </div>
  );
}
