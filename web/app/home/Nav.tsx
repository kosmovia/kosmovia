"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Item = { href: string; label: string; page?: boolean };

export default function Nav({ items, loginUrl }: { items: Item[]; loginUrl: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="kv-nav">
      <div className="kv-nav-in">
        <a href="#inicio" className="kv-brand" aria-label="Kosmovia, ir al inicio">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/kosmovia-mark.svg" alt="" width={30} height={30} />
          <span>Kosmovia</span>
        </a>

        <nav className="kv-links" aria-label="Principal">
          {items.map((i) =>
            i.page ? (
              <Link key={i.href} href={i.href}>
                {i.label}
              </Link>
            ) : (
              <a key={i.href} href={i.href}>
                {i.label}
              </a>
            ),
          )}
        </nav>

        <a className="kv-btn kv-btn-primary kv-nav-cta" href={loginUrl}>
          Ingresar
        </a>

        <button
          ref={btnRef}
          type="button"
          className="kv-burger"
          aria-expanded={open}
          aria-controls="kv-menu"
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          onClick={() => setOpen((o) => !o)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>

      <nav id="kv-menu" className="kv-menu" aria-label="Menú móvil" hidden={!open}>
        {items.map((i) =>
          i.page ? (
            <Link key={i.href} href={i.href} onClick={() => setOpen(false)}>
              {i.label}
            </Link>
          ) : (
            <a key={i.href} href={i.href} onClick={() => setOpen(false)}>
              {i.label}
            </a>
          ),
        )}
        <a className="kv-btn kv-btn-primary" href={loginUrl}>
          Ingresar
        </a>
      </nav>
    </header>
  );
}
