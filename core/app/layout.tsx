import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Providers } from "../components/Providers";
import { LoginHeaderSession } from "../components/LoginHeaderSession";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kosmovia · App",
  robots: { index: false, follow: false },
};

const links = [
  { href: "/", label: "Entrar" },
  { href: "/perfil/nuevo", label: "Crear perfil" },
  { href: "/wallet", label: "Wallet" },
  { href: "/comunidades", label: "Comunidades" },
  { href: "/perfil", label: "Perfil" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <Providers>
          <header className="app-header">
            <Link href="/" className="wordmark">
              Kosmovia
            </Link>
            <div className="header-slot" aria-label="Sesión">
              <LoginHeaderSession />
            </div>
          </header>
          <nav className="app-nav" aria-label="Principal">
            {links.map((l) => (
              <Link key={l.href} href={l.href}>
                {l.label}
              </Link>
            ))}
          </nav>
          <main className="page">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
