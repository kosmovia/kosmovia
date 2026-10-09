'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePollarStatus } from '../../lib/core/pollar.tsx';
import { usePollarAuth } from '../../lib/core/usePollarAuth.ts';
import { useCoreSession } from '../../components/CoreProviders';

/**
 * Login real (modo api): Google, email o Freighter con Pollar, y la sesión
 * firmada con core. Mismo diseño que el login de demo de Victor.
 */
export function CoreLogin() {
  const pollar = usePollarStatus();
  return (
    <div className="login-page-container">
      <div className="login-box">
        <div className="login-header">
          <span className="login-brand-icon"><img src="/brand/kosmovia-icon.svg" alt="" width={56} height={56} className="kv-brand-img" /></span>
          <h1 className="login-title">Ingresar a Kosmovia</h1>
          <p className="login-subtitle">Comunidades, canales y chat en Stellar</p>
        </div>
        {pollar.configured ? <Buttons /> : <p className="form-hint">{pollar.message}</p>}
        <Link href="/" className="login-back-link">
          ← Volver a la página principal
        </Link>
      </div>
    </div>
  );
}

function Buttons() {
  const router = useRouter();
  const { isLoading, error, loginGoogle, loginEmail, loginFreighter } = usePollarAuth();
  const session = useCoreSession();

  useEffect(() => {
    if (session.step === 'ready') router.replace('/plataforma');
  }, [session.step, router]);

  const busy = isLoading || session.step === 'loading';
  return (
    <div style={{ display: 'grid', gap: 12, marginBottom: 18 }}>
      <button type="button" className="btn-login-submit" onClick={loginGoogle} disabled={busy}>
        Entrar con Google
      </button>
      <button type="button" className="btn-login-submit" onClick={loginEmail} disabled={busy}>
        Entrar con email
      </button>
      <button type="button" className="btn-login-submit" onClick={loginFreighter} disabled={busy}>
        Conectar Freighter
      </button>
      <span className="form-hint" role="status">
        {session.step === 'loading' && !isLoading
          ? 'Abriendo tu sesión… (con Freighter, firma el mensaje)'
          : session.step === 'error'
            ? session.message
            : error ?? 'Testnet: nada usa dinero real. Con Google o email, Pollar crea tu wallet.'}
      </span>
    </div>
  );
}
