'use client';

import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { PollarAppProvider, usePollarStatus } from '../lib/core/pollar.tsx';
import { SessionBridge } from '../lib/core/SessionBridge.tsx';
import { usePollarAuth } from '../lib/core/usePollarAuth.ts';
import { tokenStore } from '../lib/core/token-store.ts';
import { apiRequest } from '../lib/core/api-client.ts';
import { CoreCreateProfile } from './CoreCreateProfile';
import { SERVICES_MODE } from '../services';

/**
 * Borrador de integración. En modo api monta Pollar y la sesión de core
 * (las mismas piezas del Providers original de core). En modo demo no
 * monta nada y la app queda igual que antes.
 */
export function CoreProviders({ children }: { children: React.ReactNode }) {
  if (SERVICES_MODE !== 'api') return <>{children}</>;
  return (
    <PollarAppProvider>
      <SessionBridge />
      {children}
    </PollarAppProvider>
  );
}

/** Estado de la sesión con core: entró con Pollar y el servidor ya le dio su cookie. */
export function useCoreSession(): { step: 'logged-out' | 'loading' | 'ready' | 'error'; message?: string } {
  const { user, isLoading } = usePollarAuth();
  const snap = useSyncExternalStore(tokenStore.subscribe, tokenStore.getSnapshot, tokenStore.getSnapshot);
  if (!user) return { step: isLoading ? 'loading' : 'logged-out' };
  if (snap.session) return { step: 'ready' };
  if (snap.status === 'error') return { step: 'error', message: snap.message ?? 'No se pudo abrir la sesión.' };
  return { step: 'loading' };
}

/**
 * Envuelve /plataforma en modo api: sin login manda a /login, y espera a que
 * la sesión con core esté lista antes de mostrar la UI (que pide datos al
 * montarse).
 */
export function CoreGate({ children }: { children: React.ReactNode }) {
  if (SERVICES_MODE !== 'api') return <>{children}</>;
  return <Gate>{children}</Gate>;
}

function Gate({ children }: { children: React.ReactNode }) {
  const pollar = usePollarStatus();
  if (!pollar.configured) return <Notice text={pollar.message} />;
  return <SessionGate>{children}</SessionGate>;
}

function SessionGate({ children }: { children: React.ReactNode }) {
  const session = useCoreSession();
  if (session.step === 'ready') return <ProfileGate>{children}</ProfileGate>;
  if (session.step === 'logged-out') {
    return (
      <Notice text="Entra con tu wallet para ver la plataforma.">
        <Link href="/login" className="btn-login-submit" style={{ display: 'inline-block', marginTop: 16 }}>
          Ingresar →
        </Link>
      </Notice>
    );
  }
  if (session.step === 'error') return <Notice text={session.message ?? 'No se pudo abrir la sesión.'} />;
  return <Notice text="Conectando con Kosmovia…" />;
}

/** Con sesión, pero sin perfil todavía: se crea aquí mismo. */
function ProfileGate({ children }: { children: React.ReactNode }) {
  const { user } = usePollarAuth();
  const [state, setState] = useState<'checking' | 'missing' | 'ok' | 'error'>('checking');
  const [message, setMessage] = useState('');

  const check = useCallback(async () => {
    setState('checking');
    const res = await apiRequest<{ profile: unknown | null }>('/api/profile');
    if (!res.ok) {
      setMessage(res.error);
      return setState('error');
    }
    setState(res.data.profile ? 'ok' : 'missing');
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (state === 'ok') return <>{children}</>;
  if (state === 'missing' && user) return <CoreCreateProfile address={user.address} onCreated={() => void check()} />;
  if (state === 'error') return <Notice text={message || 'No se pudo cargar tu perfil.'} />;
  return <Notice text="Cargando tu perfil…" />;
}

function Notice({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="login-page-container">
      <div className="login-box" role="status">
        <p className="login-subtitle">{text}</p>
        {children}
      </div>
    </div>
  );
}
