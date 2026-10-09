'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { securityService } from '../services';
import { SecurityError, type PayAsset, type PaymentApproval } from '../services/securityService';
import { PIN_LENGTH, PinPad } from './PinPad';
import { fmtAmount, fmtCountdown, fmtDateTime, pinErrorText } from './pinErrors';

export interface ApprovalRequest {
  /** @usuario o dirección G…. */
  to: string;
  /** Cómo mostrar el destino (opcional; si falta se usa `to`). */
  toLabel?: string;
  asset: PayAsset;
  amount: number;
}

type RequestApproval = (req: ApprovalRequest) => Promise<PaymentApproval | null>;

const PaymentGuardContext = createContext<RequestApproval | null>(null);

/** Pide el PIN antes de pagar. Resuelve el permiso, o null si la persona cancela. */
export function usePaymentApproval(): RequestApproval {
  const ctx = useContext(PaymentGuardContext);
  if (!ctx) throw new Error('usePaymentApproval necesita <PaymentGuardProvider> arriba en el árbol.');
  return ctx;
}

type Step = 'loading' | 'create' | 'confirm' | 'forgot' | 'reset';

interface Pending {
  /** Cada solicitud tiene su propio id: solo ella puede resolver su promesa. */
  id: number;
  req: ApprovalRequest;
  resolve: (a: PaymentApproval | null) => void;
}

const SETUP_LATER_KEY = 'kosmovia_pin_setup_later';

/** "Ahora no" en el aviso de crear el PIN: no vuelve a salir hasta el próximo inicio (otra pestaña o sesión). */
function setupPostponed(): boolean {
  try {
    return sessionStorage.getItem(SETUP_LATER_KEY) === '1';
  } catch {
    return false;
  }
}

export function PaymentGuardProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const seq = useRef(0);
  const [setupOpen, setSetupOpen] = useState(false);

  const request = useCallback<RequestApproval>((req) => {
    return new Promise((resolve) => {
      // Si ya había una petición abierta, se cancela: solo se muestra una a la vez.
      pendingRef.current?.resolve(null);
      const next: Pending = { id: ++seq.current, req, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  /** Resuelve SOLO la solicitud `id`; si ya fue cancelada o reemplazada, no hace nada. */
  const finish = useCallback((id: number, approval: PaymentApproval | null) => {
    const p = pendingRef.current;
    if (!p || p.id !== id) return;
    pendingRef.current = null;
    setPending(null);
    p.resolve(approval);
  }, []);

  /** ¿Sigue siendo `id` la solicitud activa? Una respuesta tardía de otra no debe usarse. */
  const isActive = useCallback((id: number) => pendingRef.current?.id === id, []);

  // Al abrir la plataforma con sesión: si todavía no tiene PIN, se le ofrece crearlo (una vez).
  useEffect(() => {
    if (setupPostponed()) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const check = (again: boolean) => {
      securityService
        .getStatus()
        .then((s) => {
          if (!cancelled && !s.hasPin) setSetupOpen(true);
        })
        .catch(() => {
          // La sesión puede estar terminando de abrirse: un solo reintento.
          if (!cancelled && again) retry = setTimeout(() => check(false), 4000);
        });
    };
    check(true);
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, []);

  const ctx = useMemo(() => request, [request]);

  return (
    <PaymentGuardContext.Provider value={ctx}>
      {children}
      {pending ? (
        <ApprovalDialog key={pending.id} id={pending.id} req={pending.req} onDone={finish} isActive={isActive} />
      ) : setupOpen ? (
        <SetupPinDialog
          onClose={(postpone) => {
            if (postpone) {
              try {
                sessionStorage.setItem(SETUP_LATER_KEY, '1');
              } catch {
                // Sin sessionStorage: solo vale para esta carga.
              }
            }
            setSetupOpen(false);
          }}
        />
      ) : null}
    </PaymentGuardContext.Provider>
  );
}

/** Aviso al entrar si todavía no tiene PIN de pagos: "Crea tu PIN de pagos". Se puede dejar para después. */
function SetupPinDialog({ onClose }: { onClose: (postpone: boolean) => void }) {
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [phase, setPhase] = useState<'enter' | 'again'>('enter');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusKey, setFocusKey] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    if (busy) return;
    if (phase === 'enter') {
      if (pin.length !== PIN_LENGTH) return;
      setPhase('again');
      setError(null);
      setFocusKey((k) => k + 1);
      return;
    }
    if (pin2.length !== PIN_LENGTH) return;
    if (pin2 !== pin) {
      setError('Los PIN no coinciden. Vuelve a escribirlos.');
      setPin('');
      setPin2('');
      setPhase('enter');
      setFocusKey((k) => k + 1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await securityService.setPin(pin);
      if (alive.current) onClose(false);
    } catch (err) {
      if (!alive.current || !isActive(id)) return;
      setBusy(false);
      if (err instanceof SecurityError && err.code === 'pin_exists') {
        onClose(false);
        return;
      }
      setPin('');
      setPin2('');
      setPhase('enter');
      setFocusKey((k) => k + 1);
      setError(pinErrorText(err, 'No se pudo guardar el PIN. Intenta de nuevo.'));
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose(true);
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="kv-setup-title"
    >
      <div className="modal-card kv-pay-card">
        <header className="modal-header">
          <h3 className="modal-title" id="kv-setup-title">
            Crea tu PIN de pagos
          </h3>
          <button type="button" className="modal-close-btn" onClick={() => onClose(true)} aria-label="Ahora no">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <p className="settings-tab-desc">
            Es de 6 dígitos y te lo pediremos cada vez que envíes dinero desde Kosmovia. Es una protección de la app: si un pago sale sin pasar por el
            PIN, lo marcamos como «Sin PIN» en tu historial. Sin PIN no puedes enviar pagos.
          </p>
          {phase === 'enter' ? (
            <PinPad
              key="s1"
              idPrefix="kv-setup-new"
              label="Nuevo PIN"
              value={pin}
              onChange={setPin}
              onSubmit={() => void submit()}
              error={error}
              disabled={busy}
              focusKey={focusKey}
            />
          ) : (
            <PinPad
              key="s2"
              idPrefix="kv-setup-again"
              label="Repite el PIN"
              value={pin2}
              onChange={setPin2}
              onSubmit={() => void submit()}
              error={error}
              disabled={busy}
              focusKey={focusKey}
            />
          )}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={() => onClose(true)} disabled={busy}>
              Ahora no
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || (phase === 'enter' ? pin.length !== PIN_LENGTH : pin2.length !== PIN_LENGTH)}
              onClick={() => void submit()}
            >
              {busy ? 'Guardando…' : phase === 'enter' ? 'Continuar' : 'Crear PIN'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApprovalDialog({
  id,
  req,
  onDone,
  isActive,
}: {
  id: number;
  req: ApprovalRequest;
  onDone: (id: number, a: PaymentApproval | null) => void;
  isActive: (id: number) => boolean;
}) {
  const [step, setStep] = useState<Step>('loading');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [createPhase, setCreatePhase] = useState<'enter' | 'again'>('enter');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [focusKey, setFocusKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Estado inicial: ¿ya tiene PIN? ¿está bloqueado?
  useEffect(() => {
    let cancelled = false;
    securityService
      .getStatus()
      .then((s) => {
        if (cancelled) return;
        if (s.lockedUntil) setLockedUntil(new Date(s.lockedUntil).getTime());
        setStep(s.hasPin ? 'confirm' : 'create');
      })
      .catch(() => {
        if (cancelled) return;
        setError('No se pudo revisar tu seguridad. Intenta de nuevo.');
        setStep('confirm');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Cuenta regresiva del bloqueo.
  useEffect(() => {
    if (!lockedUntil) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= lockedUntil) {
        setLockedUntil(null);
        setError(null);
        setFocusKey((k) => k + 1);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  const cancel = useCallback(() => onDone(id, null), [onDone, id]);

  // Escape cancela.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancel]);

  // Mantener el foco dentro del modal con Tab.
  const onCardKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !cardRef.current) return;
    const items = Array.from(
      cardRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]'),
    );
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

  const locked = lockedUntil !== null && lockedUntil > now;
  const remainingMs = lockedUntil ? lockedUntil - now : 0;

  const goConfirm = () => {
    setPin('');
    setPin2('');
    setCreatePhase('enter');
    setError(null);
    setStep('confirm');
    setFocusKey((k) => k + 1);
  };

  const goCreate = () => {
    setPin('');
    setPin2('');
    setCreatePhase('enter');
    setError(null);
    setStep('create');
    setFocusKey((k) => k + 1);
  };

  const confirm = async () => {
    if (busy || locked || pin.length !== PIN_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      const approval = await securityService.approve({ to: req.to, asset: req.asset, amount: req.amount, pin });
      // La respuesta de una solicitud cancelada o reemplazada se ignora: nunca debe pagar otra.
      if (!alive.current || !isActive(id)) return;
      onDone(id, approval);
    } catch (err) {
      if (!alive.current || !isActive(id)) return;
      setBusy(false);
      setPin('');
      setFocusKey((k) => k + 1);
      if (err instanceof SecurityError) {
        if (err.code === 'locked') {
          const until = err.extra.lockedUntil ? new Date(err.extra.lockedUntil).getTime() : Date.now() + 60_000;
          setNow(Date.now());
          setLockedUntil(until);
          setError(null);
          return;
        }
        if (err.code === 'no_pin') {
          goCreate();
          return;
        }
        if (err.code === 'limit_exceeded') {
          const left = err.extra.remaining;
          setError(
            left === undefined
              ? 'Supera tu límite diario.'
              : `Supera tu límite diario. Te quedan ${fmtAmount(Math.max(0, left))} ${req.asset} hoy.`,
          );
          return;
        }
        setError(pinErrorText(err, 'No se pudo confirmar el pago. Intenta de nuevo.'));
        return;
      }
      setError('No se pudo confirmar el pago. Revisa tu conexión e intenta de nuevo.');
    }
  };

  /** Crear el PIN (primera vez) o uno nuevo tras olvidarlo. */
  const createPin = async (reset: boolean) => {
    if (busy) return;
    if (createPhase === 'enter') {
      if (pin.length !== PIN_LENGTH) return;
      setCreatePhase('again');
      setError(null);
      setFocusKey((k) => k + 1);
      return;
    }
    if (pin2.length !== PIN_LENGTH) return;
    if (pin2 !== pin) {
      setError('Los PIN no coinciden. Vuelve a escribirlos.');
      setPin('');
      setPin2('');
      setCreatePhase('enter');
      setFocusKey((k) => k + 1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let pendingAt: string | null = null;
      if (reset) pendingAt = (await securityService.resetPin(pin)).pendingPinAt;
      else await securityService.setPin(pin);
      if (!alive.current || !isActive(id)) return;
      setBusy(false);
      goConfirm();
      setNotice(
        !reset
          ? 'Listo, tu PIN quedó creado.'
          : pendingAt
            ? `Listo. Tu PIN nuevo se activará el ${fmtDateTime(pendingAt)}. Hasta entonces vale el PIN actual.`
            : 'Listo, tu PIN nuevo quedó activo.',
      );
    } catch (err) {
      if (!alive.current) return;
      setBusy(false);
      if (err instanceof SecurityError && err.code === 'pin_exists') {
        goConfirm();
        return;
      }
      if (reset && err instanceof SecurityError && err.code === 'reauth_required') {
        setError(pinErrorText(err, ''));
        setStep('forgot');
        return;
      }
      setPin('');
      setPin2('');
      setCreatePhase('enter');
      setFocusKey((k) => k + 1);
      setError(pinErrorText(err, 'No se pudo guardar el PIN. Intenta de nuevo.'));
    }
  };

  const title = step === 'create' || step === 'reset' ? 'Crea tu PIN de pagos' : step === 'forgot' ? '¿Olvidaste tu PIN?' : 'Confirmar pago';

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="kv-pay-title"
    >
      <div className="modal-card kv-pay-card" ref={cardRef} onKeyDown={onCardKeyDown}>
        <header className="modal-header">
          <h3 className="modal-title" id="kv-pay-title">
            {title}
          </h3>
          <button type="button" className="modal-close-btn" onClick={cancel} aria-label="Cancelar pago">
            ✕
          </button>
        </header>

        <div className="modal-body">
          <dl className="kv-pay-summary">
            <div>
              <dt>Para</dt>
              <dd>{req.toLabel ?? req.to}</dd>
            </div>
            <div>
              <dt>Monto</dt>
              <dd className="kv-pay-amount">
                {fmtAmount(req.amount)} {req.asset}
              </dd>
            </div>
            <div>
              <dt>Red</dt>
              <dd>Stellar testnet</dd>
            </div>
          </dl>

          {step === 'loading' ? (
            <p className="settings-tab-desc" role="status">
              Revisando tu seguridad…
            </p>
          ) : null}

          {step === 'create' || step === 'reset' ? (
            <>
              <p className="settings-tab-desc">
                {step === 'reset'
                  ? 'Elige un PIN nuevo de 6 dígitos. Por seguridad se activa a las 24 horas; hasta entonces vale el anterior.'
                  : 'Es de 6 dígitos y te lo pediremos cada vez que envíes dinero desde Kosmovia. Es una protección de la app: si un pago sale sin pasar por el PIN, lo marcamos como «Sin PIN» en tu historial.'}
              </p>
              {createPhase === 'enter' ? (
                <PinPad
                  key="p1"
                  idPrefix="kv-pay-new"
                  label="Nuevo PIN"
                  value={pin}
                  onChange={setPin}
                  onSubmit={() => void createPin(step === 'reset')}
                  error={error}
                  disabled={busy}
                  focusKey={focusKey}
                />
              ) : (
                <PinPad
                  key="p2"
                  idPrefix="kv-pay-again"
                  label="Repite el PIN"
                  value={pin2}
                  onChange={setPin2}
                  onSubmit={() => void createPin(step === 'reset')}
                  error={error}
                  disabled={busy}
                  focusKey={focusKey}
                />
              )}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={cancel} disabled={busy}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || (createPhase === 'enter' ? pin.length !== PIN_LENGTH : pin2.length !== PIN_LENGTH)}
                  onClick={() => void createPin(step === 'reset')}
                >
                  {busy ? 'Guardando…' : createPhase === 'enter' ? 'Continuar' : 'Crear PIN'}
                </button>
              </div>
            </>
          ) : null}

          {step === 'confirm' ? (
            <>
              {notice ? (
                <p className="kv-pin-notice" role="status">
                  {notice}
                </p>
              ) : null}
              {locked ? (
                <p className="kv-pin-locked" role="alert">
                  Demasiados intentos. Espera para volver a intentar: <strong aria-hidden="true">{fmtCountdown(remainingMs)}</strong>.
                </p>
              ) : null}
              <PinPad
                idPrefix="kv-pay"
                label="Ingresa tu PIN"
                value={pin}
                onChange={(v) => {
                  setPin(v);
                  setNotice(null);
                }}
                onSubmit={() => void confirm()}
                error={locked ? null : error}
                disabled={busy || locked}
                focusKey={focusKey}
              />
              <div className="modal-actions kv-pay-actions">
                <button type="button" className="kv-link-btn" onClick={() => { setError(null); setStep('forgot'); }}>
                  ¿Olvidaste tu PIN?
                </button>
                <button type="button" className="btn-secondary" onClick={cancel}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || locked || pin.length !== PIN_LENGTH}
                  onClick={() => void confirm()}
                >
                  {busy ? 'Confirmando…' : 'Confirmar'}
                </button>
              </div>
            </>
          ) : null}

          {step === 'forgot' ? (
            <>
              <p className="settings-tab-desc">
                Por seguridad, para cambiar un PIN olvidado tienes que cerrar sesión y volver a entrar. Si acabas de iniciar sesión (hace menos de 10
                minutos), puedes pedir uno nuevo: se activa a las 24 horas, y hasta entonces sigue valiendo el actual (puedes cancelar el cambio con
                él desde Ajustes, Seguridad).
              </p>
              {error ? (
                <p className="kv-pin-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="modal-actions kv-pay-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setError(null);
                    goConfirm();
                  }}
                >
                  Volver
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setPin('');
                    setPin2('');
                    setCreatePhase('enter');
                    setError(null);
                    setStep('reset');
                    setFocusKey((k) => k + 1);
                  }}
                >
                  Pedir un PIN nuevo
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
