'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { miniappService, walletService } from '../../services';
import { SecurityError } from '../../services/securityService';
import type { MiniAppConnection } from '../../services/miniappService';
import type { WalletTransaction } from '../../types';
import {
  decideRequest,
  errorResponse,
  frameConfig,
  buildContext,
  isTrustedSender,
  okResponse,
  permissionLines,
  toMiniAppUser,
  type FrameConfig,
} from '../../lib/miniapp-sdk/host';
import { isRequestMessage, type MiniAppRequestMessage, type MiniAppResponseMessage } from '../../lib/miniapp-sdk/protocol';
import { PIN_LENGTH, PinPad } from '../PinPad';
import { pinErrorText } from '../pinErrors';
import type { AppProps, MiniApp } from './registry';
import './miniapp-host.css';

/** Cuánto se espera el `ready()` de la app antes de decir que no respondió. */
const READY_TIMEOUT_MS = 15_000;

export interface MiniAppHostProps extends Omit<AppProps, 'onClose'> {
  app: MiniApp;
  /** Vuelve a la lista de Aplicaciones (la app llamó a `close()`). */
  onExit: () => void;
  /** Un pago de la app ya salió: Kosmovia actualiza saldo e historial. */
  onPaid?: (tx: WalletTransaction) => void | Promise<void>;
}

type Phase = 'loading' | 'ready' | 'timeout';

type Sheet =
  | { kind: 'connect'; resolve: (connection: MiniAppConnection | null) => void }
  | { kind: 'share'; text: string; channelName: string; resolve: (accepted: boolean) => void };

/** "G…WXYZ" corto para mostrar una wallet; un @usuario se muestra tal cual (con @). */
function recipientLabel(to: string): string {
  const t = to.trim();
  if (/^G[A-Za-z2-7]{55}$/.test(t)) return `${t.slice(0, 4)}…${t.slice(-4)}`;
  return t.startsWith('@') ? t : `@${t}`;
}

/**
 * Host de mini-apps: abre la app en un <iframe> y atiende sus pedidos por postMessage
 * (protocolo en lib/miniapp-sdk/protocol.ts). Lo que decide cada pedido está en
 * lib/miniapp-sdk/host.ts; este componente solo lo ejecuta y muestra SIEMPRE interfaz
 * propia de Kosmovia para lo sensible: la hoja de conexión con PIN, la confirmación del
 * pago con PIN y la confirmación de publicar. La app nunca ve el PIN, la sesión ni las claves.
 *
 * Seguridad del mensaje: solo se atiende lo que viene del `contentWindow` de ESTE iframe y
 * con el origen esperado; todo lo demás se ignora. Una sola solicitud con ventana a la vez.
 */
export function MiniAppHost(props: MiniAppHostProps) {
  const { app } = props;
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  const [phase, setPhase] = useState<Phase>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const connection = useRef<MiniAppConnection | null>(null);
  const modalBusy = useRef(false);
  const cancelPending = useRef<(() => void) | null>(null);
  const alive = useRef(true);

  const cfg = useMemo<FrameConfig | null>(
    () => (typeof window === 'undefined' || !app.url ? null : frameConfig(app.url, window.location.origin)),
    [app.url],
  );
  const cfgRef = useRef(cfg);
  useEffect(() => {
    cfgRef.current = cfg;
  }, [cfg]);

  const reply = useCallback((message: MiniAppResponseMessage) => {
    const win = frameRef.current?.contentWindow;
    const config = cfgRef.current;
    if (!win || !config) return;
    // La ventana destino ya es la del iframe; un iframe sin same-origin tiene origen opaco ("null"), que solo admite "*".
    win.postMessage(message, config.expectedOrigin === 'null' ? '*' : config.expectedOrigin);
  }, []);

  /** La conexión de verdad (servidor): se vuelve a leer en cada pedido, por si la desconectaron en Seguridad. */
  const refreshConnection = useCallback(async () => {
    try {
      const list = await miniappService.listConnections();
      connection.current = list.find((c) => c.appId === propsRef.current.app.id) ?? null;
    } catch {
      // Sin red: se queda con lo último que se sabía.
    }
  }, []);

  /** Abre una hoja de Kosmovia y espera la respuesta de la persona. */
  const ask = useCallback(<T,>(build: (resolve: (value: T) => void) => Sheet, onCancel: T): Promise<T> => {
    return new Promise<T>((resolve) => {
      const done = (value: T) => {
        cancelPending.current = null;
        setSheet(null);
        resolve(value);
      };
      cancelPending.current = () => done(onCancel);
      setSheet(build(done));
    });
  }, []);

  const handle = useCallback(
    async (message: MiniAppRequestMessage) => {
      const p = propsRef.current;
      const id = message.id;
      if (message.method !== 'ready' && message.method !== 'close') await refreshConnection();

      const decision = decideRequest(message, {
        appPermissions: p.app.permissions,
        connection: connection.current,
        hasChannel: Boolean(p.activeChannel && p.shareToChannel),
      });

      if (decision.action === 'error') return reply(errorResponse(id, decision.code, decision.message));
      if (decision.action === 'ready') {
        setPhase('ready');
        return reply(
          okResponse(
            id,
            buildContext({
              community: p.community,
              channel: p.activeChannel ?? null,
              theme: p.theme ?? 'kosmovia',
              params: p.initialParams,
            }),
          ),
        );
      }
      if (decision.action === 'close') {
        reply(okResponse(id, undefined));
        return p.onExit();
      }
      if (decision.action === 'user') return reply(okResponse(id, toMiniAppUser(p.currentUser)));
      if (decision.action === 'connected') {
        return reply(okResponse(id, { user: toMiniAppUser(p.currentUser), permissions: connection.current?.permissions ?? [] }));
      }

      // Lo que sigue abre una ventana de Kosmovia: una a la vez.
      if (modalBusy.current) return reply(errorResponse(id, 'unknown', 'Ya hay otra solicitud abierta. Termínala primero.'));
      modalBusy.current = true;
      try {
        if (decision.action === 'connect') {
          const connected = await ask<MiniAppConnection | null>((resolve) => ({ kind: 'connect', resolve }), null);
          if (!connected) return reply(errorResponse(id, 'user_rejected', 'La persona canceló la conexión.'));
          connection.current = connected;
          return reply(okResponse(id, { user: toMiniAppUser(p.currentUser), permissions: connected.permissions }));
        }

        if (decision.action === 'pay') {
          const { to, amount, asset, note } = decision.payment;
          // La confirmación con PIN es la de Kosmovia (PaymentGuard): muestra a quién, cuánto y el concepto.
          const approval = await p.requestApproval({ to, toLabel: recipientLabel(to), asset, amount, note, appName: p.app.name });
          if (!approval) return reply(errorResponse(id, 'user_rejected', 'La persona canceló el pago.'));
          // Si la app se cerró mientras se confirmaba, nadie recibiría el resultado (y no se podría vincular el pago): no se envía.
          if (!alive.current) return;
          setWorking('Enviando tu pago…');
          try {
            const tx = await walletService.sendPayment({ to, amount, asset, approval });
            try {
              await propsRef.current.onPaid?.(tx);
            } catch {
              // El pago ya salió; refrescar el saldo es secundario.
            }
            return reply(
              okResponse(id, { paymentId: tx.id, txHash: tx.hash, amount: approval.amount, asset: 'USDC' as const, toWallet: approval.toWallet }),
            );
          } catch (err) {
            return reply(errorResponse(id, 'unknown', err instanceof Error && err.message ? err.message : 'No se pudo enviar el pago.'));
          } finally {
            setWorking(null);
          }
        }

        if (decision.action === 'share') {
          const channelName = p.activeChannel?.name ?? '';
          const accepted = await ask<boolean>((resolve) => ({ kind: 'share', text: decision.text, channelName, resolve }), false);
          if (!accepted) return reply(errorResponse(id, 'user_rejected', 'La persona canceló la publicación.'));
          try {
            const messageId = await p.shareToChannel?.(decision.text);
            if (!messageId) return reply(errorResponse(id, 'unknown', 'No se pudo publicar el mensaje.'));
            return reply(okResponse(id, { messageId }));
          } catch (err) {
            return reply(errorResponse(id, 'unknown', err instanceof Error && err.message ? err.message : 'No se pudo publicar el mensaje.'));
          }
        }
      } finally {
        modalBusy.current = false;
      }
    },
    [ask, refreshConnection, reply],
  );

  // Mensajes de la app: solo del iframe de ESTA mini-app, con el origen esperado, y solo del protocolo.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      const config = cfgRef.current;
      if (!frame || !config) return;
      if (!isTrustedSender({ fromFrame: event.source === frame.contentWindow, origin: event.origin, expectedOrigin: config.expectedOrigin })) return;
      if (!isRequestMessage(event.data)) return;
      void handle(event.data);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [handle]);

  // Si la app no avisa `ready` a tiempo, se ofrece reintentar.
  useEffect(() => {
    if (phase !== 'loading') return;
    const timer = window.setTimeout(() => setPhase((cur) => (cur === 'loading' ? 'timeout' : cur)), READY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [phase, reloadKey]);

  // Al cerrar el host con una hoja abierta, se cancela (así la promesa del pedido no queda colgada).
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelPending.current?.();
    };
  }, []);

  const retry = () => {
    setPhase('loading');
    setReloadKey((k) => k + 1);
  };

  if (!cfg) {
    return (
      <div className="kv-host-loading" role="alert">
        <strong>{app.name}</strong>
        <span>No se pudo abrir esta app.</span>
      </div>
    );
  }

  return (
    <div className="kv-host" style={{ ['--kv-host-accent' as string]: app.theme ?? 'var(--accent)' }}>
      <iframe
        key={reloadKey}
        ref={frameRef}
        className="kv-host-frame"
        src={cfg.src}
        title={app.name}
        sandbox={cfg.sandbox}
        allow=""
        referrerPolicy="no-referrer"
      />

      {phase !== 'ready' ? (
        <div className="kv-host-loading" role={phase === 'timeout' ? 'alert' : 'status'}>
          <span className="kv-host-loading-icon" aria-hidden="true">
            {app.icon}
          </span>
          <strong>{app.name}</strong>
          {phase === 'timeout' ? (
            <>
              <span>{app.name} no respondió.</span>
              <button type="button" className="btn-secondary" onClick={retry}>
                Reintentar
              </button>
            </>
          ) : (
            <>
              <span className="kv-host-spinner" aria-hidden="true" />
              <span>Abriendo…</span>
            </>
          )}
        </div>
      ) : null}

      {working ? (
        <div className="kv-host-working" role="status">
          <span className="kv-host-spinner" aria-hidden="true" />
          <span>{working}</span>
        </div>
      ) : null}

      {sheet?.kind === 'connect' ? <ConnectSheet app={app} onDone={sheet.resolve} /> : null}
      {sheet?.kind === 'share' ? <ShareSheet app={app} text={sheet.text} channelName={sheet.channelName} onDone={sheet.resolve} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ hojas de Kosmovia

/** Escape cancela y Tab se queda dentro de la hoja. */
function useSheetKeys(cardRef: React.RefObject<HTMLDivElement | null>, onCancel: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !cardRef.current) return;
    const items = Array.from(cardRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]'));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
}

function AppBadge({ app }: { app: MiniApp }) {
  return (
    <div className="kv-host-appline">
      <span className="kv-host-appicon" style={{ background: app.theme }} aria-hidden="true">
        {app.icon}
      </span>
      <span className="kv-host-appname">
        <strong>{app.name}</strong>
        <span>{app.status === 'oficial' ? 'App oficial de Kosmovia' : `App de ${app.developer}`}</span>
      </span>
    </div>
  );
}

/** La hoja de Kosmovia (no de la app) que pide permisos y el PIN para conectar. */
function ConnectSheet({ app, onDone }: { app: MiniApp; onDone: (connection: MiniAppConnection | null) => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusKey, setFocusKey] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const cancel = useCallback(() => {
    if (!busy) onDone(null);
  }, [busy, onDone]);
  const onCardKeyDown = useSheetKeys(cardRef, cancel);

  const submit = async () => {
    if (busy || pin.length !== PIN_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await miniappService.connect(app.id, pin));
    } catch (err) {
      setBusy(false);
      setPin('');
      setFocusKey((k) => k + 1);
      setError(
        err instanceof SecurityError && err.code === 'no_pin'
          ? 'Primero crea tu PIN de pagos (Ajustes de cuenta → Seguridad).'
          : pinErrorText(err, 'No se pudo conectar. Intenta de nuevo.'),
      );
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="kv-host-connect-title"
    >
      <div className="modal-card kv-pay-card" ref={cardRef} onKeyDown={onCardKeyDown}>
        <header className="modal-header">
          <h3 className="modal-title" id="kv-host-connect-title">
            Conectar con {app.name}
          </h3>
          <button type="button" className="modal-close-btn" onClick={cancel} aria-label="Cancelar" disabled={busy}>
            ✕
          </button>
        </header>
        <div className="modal-body">
          <AppBadge app={app} />
          <div>
            <p className="settings-tab-desc" style={{ margin: '0 0 6px' }}>
              {app.name} quiere:
            </p>
            <ul className="kv-host-perms">
              {permissionLines(app.permissions).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <p className="form-hint" style={{ margin: 0 }}>
            Esta ventana es de Kosmovia, no de la app: {app.name} nunca ve tu PIN. Puedes desconectarla cuando quieras en Seguridad.
          </p>
          <PinPad
            idPrefix="kv-host-connect"
            label="Tu PIN de pagos para autorizar"
            value={pin}
            onChange={setPin}
            onSubmit={() => void submit()}
            error={error}
            disabled={busy}
            focusKey={focusKey}
          />
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={cancel} disabled={busy}>
              Cancelar
            </button>
            <button type="button" className="btn-primary" disabled={busy || pin.length !== PIN_LENGTH} onClick={() => void submit()}>
              {busy ? 'Conectando…' : 'Conectar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Confirmación simple (sin PIN) de Kosmovia antes de publicar lo que pide la app. */
function ShareSheet({ app, text, channelName, onDone }: { app: MiniApp; text: string; channelName: string; onDone: (accepted: boolean) => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const cancel = useCallback(() => onDone(false), [onDone]);
  const onCardKeyDown = useSheetKeys(cardRef, cancel);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="kv-host-share-title"
    >
      <div className="modal-card kv-pay-card" ref={cardRef} onKeyDown={onCardKeyDown}>
        <header className="modal-header">
          <h3 className="modal-title" id="kv-host-share-title">
            ¿Publicar en #{channelName}?
          </h3>
          <button type="button" className="modal-close-btn" onClick={cancel} aria-label="Cancelar">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <AppBadge app={app} />
          <p className="settings-tab-desc" style={{ margin: 0 }}>
            {app.name} quiere publicar este mensaje en el canal, a tu nombre:
          </p>
          <blockquote className="kv-host-quote">{text}</blockquote>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={cancel}>
              Cancelar
            </button>
            <button type="button" className="btn-primary" autoFocus onClick={() => onDone(true)}>
              Publicar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
