'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { pushService, type NotificationPrefs } from '../services';
import {
  INSTALL_EVENT,
  currentSubscription,
  installPromptEvent,
  isIos,
  isStandalone,
  notificationPermission,
  promptInstall,
  pushSupported,
  subscribeThisDevice,
  withPushTimeout,
} from '../lib/core/push-client';

type Status =
  | 'loading'
  | 'ios-install' // iPhone/iPad: las notificaciones solo existen con la app instalada
  | 'unsupported'
  | 'unconfigured' // el servidor no tiene las claves VAPID
  | 'denied' // el navegador las bloqueó
  | 'off' // se pueden activar en este dispositivo
  | 'on'
  | 'error';

const STATUS_TEXT: Record<Status, string> = {
  loading: 'Cargando…',
  'ios-install': 'Instala la app para activarlas',
  unsupported: 'No disponibles en este navegador',
  unconfigured: 'Falta configurar el servidor',
  denied: 'Bloqueadas por el navegador',
  off: 'Desactivadas en este dispositivo',
  on: 'Activadas en este dispositivo',
  error: 'No se pudo confirmar la activación',
};

const PREF_ROWS: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  { key: 'payments', label: 'Pagos', hint: 'Cuando alguien te envía dinero.' },
  { key: 'dms', label: 'Mensajes directos', hint: 'Cuando alguien te escribe en privado.' },
  { key: 'mentions', label: 'Menciones', hint: 'Cuando alguien te nombra con @usuario en un canal.' },
];

export function NotificationSettings() {
  const [status, setStatus] = useState<Status>('loading');
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [canPrompt, setCanPrompt] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);

  const refresh = useCallback(async () => {
    const onIos = isIos();
    setIos(onIos);
    setInstalled(isStandalone());
    setCanPrompt(installPromptEvent() !== null);

    const config = await withPushTimeout(pushService.getConfig()).catch(() => ({ configured: false, publicKey: null }));
    pushService
      .getPrefs()
      .then(setPrefs)
      .catch(() => {});

    if (!pushSupported()) {
      setStatus(onIos && !isStandalone() ? 'ios-install' : 'unsupported');
      return;
    }
    if (!config.configured) {
      setStatus('unconfigured');
      return;
    }
    if (notificationPermission() === 'denied') {
      setStatus('denied');
      return;
    }
    const sub = await withPushTimeout(currentSubscription()).catch(() => null);
    if (sub && notificationPermission() === 'granted') {
      try {
        await withPushTimeout(pushService.saveSubscription(sub.toJSON()));
        setStatus('on');
      } catch {
        setStatus('error');
        setMsg({ kind: 'err', text: 'No pudimos confirmar las notificaciones con el servidor. Intenta de nuevo.' });
      }
    } else {
      setStatus('off');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onInstall = () => {
      setCanPrompt(installPromptEvent() !== null);
      setInstalled(isStandalone());
    };
    window.addEventListener(INSTALL_EVENT, onInstall);
    return () => window.removeEventListener(INSTALL_EVENT, onInstall);
  }, [refresh]);

  const enable = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const config = await withPushTimeout(pushService.getConfig());
      if (!config.configured || !config.publicKey) {
        setStatus('unconfigured');
        return;
      }
      const permission = await withPushTimeout(Notification.requestPermission(), 30_000);
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'off');
        setMsg({ kind: 'err', text: 'No diste permiso. Puedes activarlo cuando quieras.' });
        return;
      }
      const sub = await subscribeThisDevice(config.publicKey);
      await withPushTimeout(pushService.saveSubscription(sub.toJSON()));
      setStatus('on');
      setMsg({ kind: 'ok', text: 'Listo: las notificaciones están activadas en este dispositivo.' });
    } catch {
      setMsg({ kind: 'err', text: 'No se pudieron activar las notificaciones. Intenta de nuevo.' });
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const sub = await withPushTimeout(currentSubscription()).catch(() => null);
      if (sub) {
        const endpoint = sub.endpoint;
        await withPushTimeout(sub.unsubscribe()).catch(() => false);
        await withPushTimeout(pushService.removeSubscription(endpoint));
      }
      setStatus('off');
      setMsg({ kind: 'ok', text: 'Notificaciones desactivadas en este dispositivo.' });
    } catch {
      setMsg({ kind: 'err', text: 'No se pudieron desactivar. Intenta de nuevo.' });
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (key: keyof NotificationPrefs, value: boolean) => {
    if (!prefs) return;
    const before = prefs;
    setPrefs({ ...prefs, [key]: value });
    try {
      setPrefs(await pushService.setPrefs({ [key]: value }));
    } catch {
      setPrefs(before);
      setMsg({ kind: 'err', text: 'No se pudo guardar el cambio. Intenta de nuevo.' });
    }
  };

  const install = async () => {
    const accepted = await promptInstall();
    if (accepted) setMsg({ kind: 'ok', text: 'Instalando Kosmovia…' });
  };

  return (
    <div className="modal-body">
      <div className="kv-sec-status">
        <div>
          <h4 style={{ margin: 0, fontSize: 14 }}>Notificaciones</h4>
          <p className="settings-tab-desc" style={{ margin: '4px 0 0' }}>
            Recibe un aviso en este dispositivo aunque no tengas Kosmovia abierta.
          </p>
        </div>
        <span className={`kv-sec-badge ${status === 'on' ? 'on' : 'off'}`} role="status">
          {STATUS_TEXT[status]}
        </span>
      </div>

      {msg ? (
        <p className={`kv-sec-msg ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>
          {msg.text}
        </p>
      ) : null}

      {status === 'unconfigured' ? (
        <p className="settings-tab-desc">El servidor todavía no tiene las claves de notificaciones. Avisa a quien administra Kosmovia.</p>
      ) : null}
      {status === 'denied' ? (
        <p className="settings-tab-desc">
          Bloqueaste las notificaciones de Kosmovia. Para usarlas, permítelas en la configuración del sitio de tu navegador y vuelve aquí.
        </p>
      ) : null}
      {status === 'unsupported' ? (
        <p className="settings-tab-desc">Este navegador no admite notificaciones push. Prueba con Chrome, Edge, Firefox o Safari actualizado.</p>
      ) : null}
      {status === 'ios-install' ? (
        <p className="settings-tab-desc">
          En iPhone y iPad (iOS 16.4 o más) las notificaciones funcionan solo con la app instalada: instálala con Compartir → Agregar a inicio, ábrela
          desde el ícono y vuelve a esta pantalla.
        </p>
      ) : null}

      <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
        {status === 'off' || status === 'denied' || status === 'error' ? (
          <button type="button" className="btn-primary" onClick={() => void enable()} disabled={busy || status === 'denied'}>
            Activar notificaciones
          </button>
        ) : null}
        {status === 'on' ? (
          <button type="button" className="btn-secondary" onClick={() => void disable()} disabled={busy}>
            Desactivar en este dispositivo
          </button>
        ) : null}
      </div>

      <div className="kv-sec-block">
        <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Qué avisos quieres</h4>
        {PREF_ROWS.map((row) => (
          <label key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', cursor: prefs ? 'pointer' : 'default' }}>
            <input
              type="checkbox"
              checked={prefs ? prefs[row.key] : false}
              disabled={!prefs}
              onChange={(e) => void toggle(row.key, e.target.checked)}
              style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
            />
            <span>
              <strong style={{ fontSize: 14 }}>{row.label}</strong>
              <span className="settings-tab-desc" style={{ display: 'block', margin: 0 }}>
                {row.hint}
              </span>
            </span>
          </label>
        ))}
        <p className="settings-tab-desc" style={{ margin: '4px 0 0' }}>
          Estos avisos valen para todos tus dispositivos.
        </p>
      </div>

      <div className="kv-sec-block">
        <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>Instalar app</h4>
        {installed ? (
          <p className="settings-tab-desc" style={{ margin: 0 }}>
            Kosmovia ya está instalada en este dispositivo.
          </p>
        ) : ios ? (
          <p className="settings-tab-desc" style={{ margin: 0 }}>
            En iPhone o iPad abre Kosmovia en Safari, toca Compartir y elige «Agregar a inicio».
          </p>
        ) : canPrompt ? (
          <button type="button" className="btn-secondary" onClick={() => void install()}>
            Instalar app
          </button>
        ) : (
          <p className="settings-tab-desc" style={{ margin: 0 }}>
            Si tu navegador lo permite, busca «Instalar Kosmovia» en su menú o en la barra de direcciones.
          </p>
        )}
      </div>
    </div>
  );
}
