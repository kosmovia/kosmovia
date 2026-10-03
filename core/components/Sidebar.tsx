"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconComunidades, IconPerfil, IconWallet } from "./icons";

const items = [
  { href: "/comunidades", label: "Comunidades", Icon: IconComunidades },
  { href: "/wallet", label: "Wallet", Icon: IconWallet },
  { href: "/perfil", label: "Perfil", Icon: IconPerfil },
];

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav className={className} aria-label="Principal">
      <ul className="sidebar-nav">
        {items.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="sidebar-link"
              aria-current={pathname === href ? "page" : undefined}
            >
              <Icon className="sidebar-icon" aria-hidden="true" />
              <span className="sidebar-label">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
