'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { SOCIAL_LINKS, TRUST_LINKS } from '../lib/trust-links';

// Información de primera visita, independiente de la aceptación de términos del login.
const WELCOME_KEY = 'kosmovia:trust-welcome:v1';
let welcomedInSession = false;

function rememberWelcome() {
  welcomedInSession = true;
  try { window.localStorage.setItem(WELCOME_KEY, 'seen'); } catch { /* Seguir si el navegador bloquea almacenamiento. */ }
}

export function FirstRunTrust({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'welcome' | 'done'>('loading');
  useEffect(() => {
    let seen = welcomedInSession;
    try { seen = seen || window.localStorage.getItem(WELCOME_KEY) === 'seen'; } catch { /* Usar memoria de sesión. */ }
    setState(seen ? 'done' : 'welcome');
  }, []);

  if (state === 'loading') return <div className="kv-welcome-page" role="status">Preparando Kosmovia…</div>;
  if (state === 'done') return <>{children}</>;
  return <TrustWelcome onContinue={() => { rememberWelcome(); setState('done'); }} />;
}

export function TrustWelcome({ onContinue }: { onContinue?: () => void }) {
  return (
    <main className="kv-welcome-page">
      <div className="kv-welcome-card">
        <header className="kv-welcome-header">
          <Link href="/" className="kv-welcome-brand" aria-label="Kosmovia, página principal">
            <img src="/brand/kosmovia-icon.svg" alt="" width={36} height={36} />
            <span>Kosmovia</span>
          </Link>
          <span className="kv-welcome-beta">Beta · Stellar testnet</span>
        </header>

        <div className="kv-welcome-hero">
          <img src="/brand/kosmovia-icon.svg" alt="" width={72} height={72} />
          <p className="kv-welcome-eyebrow">TU COMUNIDAD, MÁS CERCA</p>
          <h1>Bienvenido a Kosmovia</h1>
          <p>Conecta con tu comunidad, comparte ideas y descubre lo que puedes hacer en Stellar.</p>
        </div>

        <ul className="kv-welcome-features" aria-label="Qué puedes hacer">
          <li><span aria-hidden="true">💬</span><div><h2>Conversa y comparte</h2><p>Comunidades, mensajes directos, fotos y archivos.</p></div></li>
          <li><span aria-hidden="true">✦</span><div><h2>Tu identidad y wallet</h2><p>Un @usuario y tu Kosmonauta para conectar y probar pagos.</p></div></li>
          <li><span aria-hidden="true">🚀</span><div><h2>Explora mini apps</h2><p>Vaquita, Retos y Aprende, con permisos que tú controlas.</p></div></li>
        </ul>

        <p className="kv-welcome-testnet"><strong>Estamos en testnet.</strong> Los saldos y pagos son de prueba, sin dinero real.</p>

        <section className="kv-welcome-trust" aria-labelledby="kv-welcome-trust-title">
          <h2 id="kv-welcome-trust-title">Antes de empezar</h2>
          <p>Conoce cómo funciona Kosmovia y cómo se usa tu información.</p>
          <nav aria-label="Términos, privacidad y guía" className="kv-welcome-docs">
            {TRUST_LINKS.map(link => <Link key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">{link.label} <span aria-hidden="true">↗</span><span className="kv-welcome-sr"> (se abre en una pestaña nueva)</span></Link>)}
          </nav>
        </section>

        {onContinue ? <button type="button" className="kv-welcome-continue" onClick={onContinue}>Continuar a Kosmovia <span aria-hidden="true">→</span></button> : <Link className="kv-welcome-continue" href="/login" onClick={rememberWelcome}>Continuar a Kosmovia <span aria-hidden="true">→</span></Link>}

        <footer className="kv-welcome-community">
          <p>Sigue a la comunidad oficial</p>
          <nav aria-label="Redes y comunidad">
            {SOCIAL_LINKS.map(link => <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" aria-label={link.label + ' (se abre en una pestaña nueva)'}>{link.label} <span aria-hidden="true">↗</span></a>)}
          </nav>
        </footer>
      </div>
    </main>
  );
}
