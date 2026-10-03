import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Providers } from "../components/Providers";
import { LoginHeaderSession } from "../components/LoginHeaderSession";
import { Sidebar } from "../components/Sidebar";
import { SidebarUser } from "../components/SidebarUser";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kosmovia · App",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <Providers>
          <div className="app-shell">
            <header className="app-topbar">
              <Link href="/" className="wordmark">
                Kosmovia
              </Link>
              <div className="header-slot" aria-label="Sesión">
                <LoginHeaderSession />
              </div>
            </header>
            <div className="app-body">
              <aside className="sidebar sidebar-desktop">
                <Sidebar />
                <SidebarUser />
              </aside>
              <main className="main-content">{children}</main>
            </div>
            <Sidebar className="sidebar sidebar-mobile" />
          </div>
        </Providers>
      </body>
    </html>
  );
}
