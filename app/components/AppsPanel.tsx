'use client';

import React, { useEffect, useRef, useState } from 'react';
import { IconClose } from './Icons';
import { isOpenable, MINI_APPS, PERMISSION_LABELS, type AppProps, type MiniApp } from './apps/registry';

type PanelProps = AppProps & { /** App que se abre al montar el panel. */ initialAppId?: string };

/**
 * Panel derecho "Aplicaciones" (mini-apps al estilo Farcaster). Misma anchura y
 * comportamiento que Mi Wallet y Notificaciones. Escape: vuelve a la lista y, si ya
 * estás en la lista, cierra el panel.
 */
export function AppsPanel(props: PanelProps) {
  const { onClose, initialAppId, ...appProps } = props;
  const [openId, setOpenId] = useState<string | null>(initialAppId ?? null);
  const panelRef = useRef<HTMLElement>(null);
  const openApp = MINI_APPS.find((a) => a.id === openId && isOpenable(a)) ?? null;

  // Al abrir el panel o una app, el foco entra al panel (así Escape funciona sin tocar nada).
  useEffect(() => {
    panelRef.current?.focus();
  }, [openId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (openApp) setOpenId(null);
    else onClose();
  };

  const soon = MINI_APPS.filter((a) => !isOpenable(a));
  const ready = MINI_APPS.filter((a) => isOpenable(a));
  const AppView = openApp?.component;

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      className="member-sidebar kv-docked-panel kv-apps-panel"
      aria-label="Aplicaciones"
      onKeyDown={handleKeyDown}
    >
      <div className="kv-panel-head">
        {openApp ? (
          <div className="kv-apps-head-app">
            <button type="button" className="kv-apps-back" onClick={() => setOpenId(null)} aria-label="Volver a Aplicaciones">
              <span aria-hidden="true">←</span>
            </button>
            <span className="kv-panel-title">{openApp.name}</span>
            <span className="kv-app-badge official">{openApp.status === 'oficial' ? 'Oficial' : 'Aprobada'}</span>
          </div>
        ) : (
          <span className="kv-panel-title">Aplicaciones</span>
        )}
        <button type="button" className="wallet-close-btn" onClick={onClose} aria-label="Cerrar aplicaciones">
          <IconClose size={18} />
        </button>
      </div>

      <div className="kv-panel-body">
        {AppView && openApp ? (
          <AppView {...appProps} onClose={onClose} />
        ) : (
          <>
            <p className="kv-apps-intro">Mini-apps para usar dentro de tu comunidad.</p>
            <ul className="kv-apps-list" aria-label="Disponibles">
              {ready.map((app) => (
                <li key={app.id}>
                  <AppCard app={app} onOpen={() => setOpenId(app.id)} />
                </li>
              ))}
            </ul>
            <h3 className="kv-apps-section">Próximamente</h3>
            <ul className="kv-apps-list" aria-label="Próximamente">
              {soon.map((app) => (
                <li key={app.id}>
                  <AppCard app={app} />
                </li>
              ))}
              <li>
                <div className="kv-app-card kv-app-card-dev" aria-disabled="true">
                  <span className="kv-app-icon" aria-hidden="true">🛠️</span>
                  <span className="kv-app-text">
                    <span className="kv-app-name">
                      Crea tu mini-app <span className="kv-app-badge soon">Pronto</span>
                    </span>
                    <span className="kv-app-tagline">Pronto podrás publicar tus apps en Kosmovia con nuestra API</span>
                  </span>
                </div>
              </li>
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}

function AppCard({ app, onOpen }: { app: MiniApp; onOpen?: () => void }) {
  const open = isOpenable(app);
  const perms = app.permissions.map((p) => PERMISSION_LABELS[p]).join(' · ');
  const body = (
    <>
      <span className="kv-app-icon" aria-hidden="true">{app.icon}</span>
      <span className="kv-app-text">
        <span className="kv-app-name">
          {app.name}
          {open ? (
            <span className="kv-app-badge official">{app.status === 'oficial' ? 'Oficial' : 'Aprobada'}</span>
          ) : (
            <span className="kv-app-badge soon">{app.status === 'en_revision' ? 'En revisión' : 'Pronto'}</span>
          )}
        </span>
        <span className="kv-app-tagline">{app.tagline}</span>
        {open ? <span className="kv-app-perms">Usa: {perms}</span> : null}
      </span>
    </>
  );
  if (!open) {
    return (
      <div className="kv-app-card kv-app-card-soon" aria-disabled="true">
        {body}
      </div>
    );
  }
  return (
    <button type="button" className="kv-app-card" onClick={onOpen} aria-label={`Abrir ${app.name}`}>
      {body}
    </button>
  );
}
