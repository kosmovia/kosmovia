'use client';

import React from 'react';
import Link from 'next/link';
import SiteFooter from '../components/SiteFooter';

export default function LandingPage() {
  return (
    <div className="landing-wrapper">
      <header className="landing-nav">
        <Link href="/" className="landing-brand">
          <img src="/brand/kosmovia-mark.svg" alt="" width={30} height={30} className="landing-brand-logo" />
          <span>Kosmovia</span>
        </Link>
        <div className="landing-nav-actions">
          <Link href="/login" className="btn-nav-login">
            Iniciar Sesión
          </Link>
          <Link href="/plataforma" className="btn-nav-primary">
            Abrir Plataforma
          </Link>
        </div>
      </header>

      <main className="landing-hero">
        <div className="landing-tag-badge">
          <span>🇧🇴 Stellar Elite Bolivia · Infraestructura B2B</span>
        </div>

        <h1 className="landing-hero-title">
          Comunidades, Billetera y Pagos en Stellar{' '}
          <span className="highlight">para Empresas</span>
        </h1>

        <p className="landing-hero-desc">
          La red social y financiera para Bolivia: comunidades estilo Towns/Discord,
          cobros instantáneos en USDC sin comisiones abusivas y validación de identidad KYC empresarial.
        </p>

        <div className="landing-cta-row">
          <Link href="/login" className="btn-cta-main">
            Ingresar a Kosmovia
          </Link>
          <Link href="/plataforma" className="btn-cta-secondary">
            Ver Demo de Comunidades →
          </Link>
        </div>
      </main>

      <section className="landing-grid" aria-label="Características de la plataforma">
        <article className="landing-card">
          <div className="landing-card-icon">⚡</div>
          <h2 className="landing-card-title">Billetera No Custodia</h2>
          <p className="landing-card-desc">
            Crea tu wallet al registrarte con Passkeys (WebAuthn). Sin frases semilla ni extensiones complicadas, con comisiones patrocinadas en Stellar.
          </p>
        </article>

        <article className="landing-card">
          <div className="landing-card-icon">🏢</div>
          <h2 className="landing-card-title">Pagos B2B en Bolivia</h2>
          <p className="landing-card-desc">
            Cobros y transferencias instantáneas entre empresas, concesionarias y comercios mediante activos en Stellar (USDC) con comprobantes verificables.
          </p>
        </article>

        <article className="landing-card">
          <div className="landing-card-icon">🛡️</div>
          <h2 className="landing-card-title">Verificación KYC Empresa</h2>
          <p className="landing-card-desc">
            Identidad corporativa respaldada en la nube para operar con entidades financieras y generar credibilidad institucional.
          </p>
        </article>
      </section>

      <SiteFooter />
    </div>
  );
}
