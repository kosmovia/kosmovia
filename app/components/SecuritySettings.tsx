'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { securityService } from '../services';
import { SecurityError, type PayAsset, type SecurityStatus } from '../services/securityService';
import { PIN_LENGTH, PinPad } from './PinPad';
import { fmtAmount, fmtCountdown, fmtDateTime, pinErrorText } from './pinErrors';

const ASSETS: PayAsset[] = ['USDC', 'XLM'];
type Mode = 'idle' | 'pin' | 'limits' | 'cancel';

/** Pestaña "Seguridad" de la configuración de cuenta: PIN de pagos y límite diario. */
export function SecuritySettings() {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [mode, setMode] = useState<Mode>('idle');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusKey, setFocusKey] = useState(0);

  // Formulario de PIN
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  // Formulario de límites
  const [limits, setLimits] = useState<Record<PayAsset, string>>({ USDC: '', XLM: '' });
  const [limitPin, setLimitPin] = useState('');
  // Cancelar un cambio de PIN pendiente
  const [cancelPin, setCancelPin] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const s = await securityService.getStatus();
      setStatus(s);
      setLoadError(false);
      setLimits({ USDC: String(s.dailyLimit.USDC), XLM: String(s.dailyLimit.XLM) });
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const lockedMs = status?.lockedUntil ? new Date(status.lockedUntil).getTime() - now : 0;
  const locked = lockedMs > 0;
  useEffect(() => {
    if (!locked) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [locked]);

  const hasPin = status?.hasPin ?? false;

  const resetForms = () => {
    setCurrent('');
    setNext('');
    setAgain('');
    setLimitPin('');
    setCancelPin('');
    setFocusKey((k) => k + 1);
  };

  const open = (m: Mode) => {
    setMsg(null);
    resetForms();
    setMode(m);
    if (status) setLimits({ USDC: String(status.dailyLimit.USDC), XLM: String(status.dailyLimit.XLM) });
  };

  const savePin = async () => {
    if (busy) return;
    if (next !== again) {
      setMsg({ kind: 'err', text: 'Los PIN nuevos no coinciden.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await securityService.setPin(next, hasPin ? current : undefined);
      setMode('idle');
      resetForms();
      setMsg({ kind: 'ok', text: hasPin ? 'Cambiaste tu PIN.' : 'Creaste tu PIN de pagos.' });
      await load();
    } catch (err) {
      setCurrent('');
      setFocusKey((k) => k + 1);
      setMsg({ kind: 'err', text: pinErrorText(err, 'No se pudo guardar el PIN. Intenta de nuevo.') });
      if (err instanceof SecurityError && (err.code === 'locked' || err.code === 'wrong_pin')) await load();
    } finally {
      setBusy(false);
    }
  };

  const cancelReset = async () => {
    if (busy || cancelPin.length !== PIN_LENGTH) return;
    setBusy(true);
    setMsg(null);
    try {
      await securityService.cancelPinReset(cancelPin);
      setMode('idle');
      resetForms();
      setMsg({ kind: 'ok', text: 'Cancelamos el cambio de PIN. Sigue valiendo tu PIN actual.' });
      await load();
    } catch (err) {
      setCancelPin('');
      setFocusKey((k) => k + 1);
      setMsg({ kind: 'err', text: pinErrorText(err, 'No se pudo cancelar el cambio. Intenta de nuevo.') });
      if (err instanceof SecurityError && (err.code === 'locked' || err.code === 'wrong_pin')) await load();
    } finally {
      setBusy(false);
    }
  };

  const parsed: Partial<Record<PayAsset, number>> = {};
  let limitsValid = true;
  for (const a of ASSETS) {
    const n = Number(limits[a].replace(',', '.'));
    if (!limits[a].trim() || !Number.isFinite(n) || n < 0) limitsValid = false;
    else parsed[a] = n;
  }

  const saveLimits = async () => {
    if (busy || !limitsValid || limitPin.length !== PIN_LENGTH) return;
    setBusy(true);
    setMsg(null);
    try {
      const s = await securityService.setDailyLimit(parsed, limitPin);
      setStatus(s);
      setMode('idle');
      resetForms();
      setMsg({ kind: 'ok', text: 'Guardamos tus límites diarios.' });
    } catch (err) {
      setLimitPin('');
      setFocusKey((k) => k + 1);
      setMsg({ kind: 'err', text: pinErrorText(err, 'No se pudieron guardar los límites. Intenta de nuevo.') });
      if (err instanceof SecurityError && (err.code === 'locked' || err.code === 'wrong_pin')) await load();
    } finally {
      setBusy(false);
    }
  };

  const pinFormReady =
    next.length === PIN_LENGTH && again.length === PIN_LENGTH && (!hasPin || current.length === PIN_LENGTH);

  if (!status && !loadError) {
    return (
      <div className="modal-body">
        <p className="settings-tab-desc" role="status">
          Cargando tu seguridad…
        </p>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="modal-body">
        <p className="kv-sec-msg err" role="alert">
          No se pudo cargar tu seguridad.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={() => void load()}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-body">
      <div className="kv-sec-status">
        <div>
          <h4 style={{ margin: 0, fontSize: 14 }}>PIN de pagos</h4>
          <p className="settings-tab-desc" style={{ margin: '4px 0 0' }}>
            Se pide cada vez que envías dinero desde Kosmovia. Es una protección de la app: un pago que salga sin pasar por el PIN queda
            marcado como «Sin PIN» en tu historial. No bloquea la firma de tu wallet en este navegador: si alguien con tu sesión abierta paga sin pasar por
            aquí, solo lo detectamos y lo marcamos.
          </p>
        </div>
        <span className={`kv-sec-badge ${hasPin ? 'on' : 'off'}`}>{hasPin ? 'PIN activo' : 'Crea tu PIN'}</span>
      </div>

      {locked ? (
        <p className="kv-pin-locked" role="alert">
          PIN bloqueado por intentos fallidos. Espera para volver a intentar: <strong aria-hidden="true">{fmtCountdown(lockedMs)}</strong>.
        </p>
      ) : null}

      {msg ? (
        <p className={`kv-sec-msg ${msg.kind}`} role={msg.kind === 'err' ? 'alert' : 'status'}>
          {msg.text}
        </p>
      ) : null}

      {status.pendingPinAt ? (
        <div className="kv-sec-block" role="alert">
          <h4>Cambio de PIN pendiente</h4>
          <p className="settings-tab-desc" style={{ margin: 0 }}>
            Pediste un PIN nuevo. Se activará el {fmtDateTime(status.pendingPinAt)}; hasta entonces sigue valiendo tu PIN actual. Si no fuiste tú,
            cancela el cambio con tu PIN actual.
          </p>
          {mode === 'cancel' ? (
            <form
              style={{ display: 'grid', gap: 12 }}
              onSubmit={(e) => {
                e.preventDefault();
                void cancelReset();
              }}
            >
              <PinPad
                idPrefix="kv-sec-cancel"
                label="Tu PIN actual"
                value={cancelPin}
                onChange={setCancelPin}
                onSubmit={() => void cancelReset()}
                disabled={busy || locked}
                focusKey={focusKey}
              />
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => open('idle')} disabled={busy}>
                  Volver
                </button>
                <button type="submit" className="btn-primary" disabled={busy || locked || cancelPin.length !== PIN_LENGTH}>
                  {busy ? 'Cancelando…' : 'Cancelar el cambio'}
                </button>
              </div>
            </form>
          ) : (
            <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
              <button type="button" className="btn-secondary" onClick={() => open('cancel')} disabled={locked}>
                Cancelar el cambio de PIN
              </button>
            </div>
          )}
        </div>
      ) : null}

      {mode === 'pin' ? (
        <form
          className="kv-sec-block"
          onSubmit={(e) => {
            e.preventDefault();
            if (pinFormReady) void savePin();
          }}
        >
          <h4>{hasPin ? 'Cambiar PIN' : 'Crear PIN'}</h4>
          {hasPin ? (
            <PinPad idPrefix="kv-sec-cur" label="PIN actual" value={current} onChange={setCurrent} disabled={busy || locked} focusKey={focusKey} />
          ) : null}
          <PinPad
            idPrefix="kv-sec-new"
            label="PIN nuevo"
            value={next}
            onChange={setNext}
            disabled={busy || locked}
            autoFocus={!hasPin}
          />
          <PinPad
            idPrefix="kv-sec-again"
            label="Repite el PIN nuevo"
            value={again}
            onChange={setAgain}
            onSubmit={() => pinFormReady && void savePin()}
            disabled={busy || locked}
            autoFocus={false}
          />
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={() => open('idle')} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={busy || locked || !pinFormReady}>
              {busy ? 'Guardando…' : 'Guardar PIN'}
            </button>
          </div>
        </form>
      ) : (
        <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
          <button type="button" className="btn-secondary" onClick={() => open('pin')} disabled={locked}>
            {hasPin ? 'Cambiar PIN' : 'Crear PIN'}
          </button>
        </div>
      )}

      <div className="kv-sec-block">
        <h4>Límite diario</h4>
        <p className="settings-tab-desc" style={{ margin: 0 }}>
          Lo máximo que puedes enviar en 24 horas, por activo.
        </p>
        {mode === 'limits' ? (
          <form
            style={{ display: 'grid', gap: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              void saveLimits();
            }}
          >
            {ASSETS.map((a) => (
              <div className="form-group kv-sec-limit" key={a}>
                <label className="form-label" htmlFor={`kv-limit-${a}`}>
                  Límite en {a}
                </label>
                <input
                  id={`kv-limit-${a}`}
                  className="form-input"
                  inputMode="decimal"
                  autoComplete="off"
                  value={limits[a]}
                  disabled={busy}
                  onChange={(e) => setLimits((l) => ({ ...l, [a]: e.target.value }))}
                  aria-invalid={limits[a].trim() !== '' && !Number.isFinite(Number(limits[a].replace(',', '.'))) ? true : undefined}
                />
                <span className="kv-sec-used">
                  Usado hoy: {fmtAmount(status.spentToday[a])} {a}
                </span>
              </div>
            ))}
            <PinPad
              idPrefix="kv-sec-lim"
              label="Tu PIN para guardar"
              value={limitPin}
              onChange={setLimitPin}
              onSubmit={() => void saveLimits()}
              disabled={busy || locked}
              autoFocus={false}
              focusKey={focusKey}
            />
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => open('idle')} disabled={busy}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={busy || locked || !limitsValid || limitPin.length !== PIN_LENGTH}>
                {busy ? 'Guardando…' : 'Guardar límites'}
              </button>
            </div>
          </form>
        ) : (
          <>
            {ASSETS.map((a) => (
              <div key={a} className="kv-sec-limit">
                <span style={{ fontSize: 14 }}>
                  <strong>{a}</strong>: {fmtAmount(status.dailyLimit[a])} al día
                </span>
                <span className="kv-sec-used">
                  Usado hoy: {fmtAmount(status.spentToday[a])} {a}
                </span>
              </div>
            ))}
            <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
              <button type="button" className="btn-secondary" onClick={() => open('limits')} disabled={!hasPin || locked}>
                Cambiar límites
              </button>
              {!hasPin ? <span className="form-hint">Crea tu PIN primero.</span> : null}
            </div>
          </>
        )}
      </div>

      <div className="kv-sec-status kv-sec-soon">
        <div>
          <h4 style={{ margin: 0, fontSize: 14 }}>Huella o Face ID</h4>
          <p className="settings-tab-desc" style={{ margin: '4px 0 0' }}>
            Confirmar pagos con tu dispositivo.
          </p>
        </div>
        <button type="button" className="btn-connect-wallet" disabled>
          Próximamente
        </button>
      </div>
    </div>
  );
}
