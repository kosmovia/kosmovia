'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { SERVICES_MODE } from '../../services';
import { CoreLogin } from './CoreLogin';

export default function LoginPage() {
  // Modo api: login real con Pollar. Modo demo: el login de siempre.
  if (SERVICES_MODE === 'api') return <CoreLogin />;
  return <DemoLogin />;
}

function DemoLogin() {
  const [username, setUsername] = useState('@victor');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // Navegación directa e instantánea a la plataforma
    window.location.href = '/plataforma';
  };

  return (
    <div className="login-page-container">
      <div className="login-box">
        <div className="login-header">
          <span className="login-brand-icon"><img src="/brand/kosmovia-icon.svg" alt="" width={56} height={56} className="kv-brand-img" /></span>
          <h1 className="login-title">Ingresar a Kosmovia</h1>
          <p className="login-subtitle">
            Comunidades, canales y chat en Stellar
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ marginBottom: '18px' }}>
            <label className="form-label">Identidad @usuario</label>
            <input
              type="text"
              className="form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ej: @usuario"
              required
            />
            <span className="form-hint">
              Acceso descentralizado sin contraseña con Passkeys.
            </span>
          </div>

          <button
            type="submit"
            className="btn-login-submit"
            disabled={isLoading}
          >
            {isLoading ? 'Ingresando...' : 'Ingresar a la Plataforma →'}
          </button>
        </form>

        <Link href="/" className="login-back-link">
          ← Volver a la página principal
        </Link>
      </div>
    </div>
  );
}
