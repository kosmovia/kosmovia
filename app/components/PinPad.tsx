'use client';

import React, { useEffect, useRef, useState } from 'react';

export const PIN_LENGTH = 6;

interface PinPadProps {
  /** Dígitos escritos hasta ahora (0 a 6). */
  value: string;
  onChange: (value: string) => void;
  /** Se llama con Enter cuando ya hay 6 dígitos. */
  onSubmit?: () => void;
  label: string;
  /** Texto de error: marca las casillas como inválidas y se anuncia al lector de pantalla. */
  error?: string | null;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Cambia para volver a enfocar la primera casilla libre (p. ej. tras un error). */
  focusKey?: number | string;
  /** Prefijo único para los ids cuando hay más de un PinPad en pantalla. */
  idPrefix: string;
}

/**
 * Seis casillas para el PIN. Avanza solo, el retroceso vuelve, pegar 6 dígitos funciona.
 * Los dígitos se ocultan (•) salvo que la persona pulse "Mostrar".
 */
export function PinPad({ value, onChange, onSubmit, label, error, disabled, autoFocus = true, focusKey, idPrefix }: PinPadProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const [show, setShow] = useState(false);
  const digits = value.split('');

  const focusAt = (i: number) => {
    const el = refs.current[Math.max(0, Math.min(PIN_LENGTH - 1, i))];
    el?.focus();
    el?.select();
  };

  useEffect(() => {
    if (!autoFocus || disabled) return;
    focusAt(Math.min(value.length, PIN_LENGTH - 1));
    // Solo al montar o cuando cambia focusKey / se habilita.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, disabled]);

  const onInput = (i: number, raw: string) => {
    const clean = raw.replace(/\D/g, '');
    if (!clean) return;
    if (clean.length > 1) {
      // Autocompletado o pegado en una sola casilla: reparte desde esta.
      const next = (value.slice(0, i) + clean).slice(0, PIN_LENGTH);
      onChange(next);
      focusAt(next.length >= PIN_LENGTH ? PIN_LENGTH - 1 : next.length);
      return;
    }
    if (i >= value.length) {
      onChange(value + clean);
      focusAt(value.length + 1);
      return;
    }
    onChange(value.slice(0, i) + clean + value.slice(i + 1));
    focusAt(i + 1);
  };

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digits[i]) {
        onChange(value.slice(0, i) + value.slice(i + 1));
        focusAt(i);
      } else {
        onChange(value.slice(0, Math.max(0, i - 1)) + value.slice(i));
        focusAt(i - 1);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusAt(i - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusAt(i + 1);
    } else if (e.key === 'Enter') {
      if (value.length === PIN_LENGTH && onSubmit) {
        e.preventDefault();
        onSubmit();
      }
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, PIN_LENGTH);
    if (!text) return;
    e.preventDefault();
    onChange(text);
    focusAt(text.length >= PIN_LENGTH ? PIN_LENGTH - 1 : text.length);
  };

  const groupId = `${idPrefix}-pin`;
  const errId = `${groupId}-err`;

  return (
    <div className="kv-pin" role="group" aria-labelledby={`${groupId}-label`}>
      <span id={`${groupId}-label`} className="form-label">
        {label}
      </span>
      <div className="kv-pin-row">
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className={`kv-pin-cell${error ? ' invalid' : ''}`}
            type={show ? 'text' : 'password'}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={digits[i] ?? ''}
            disabled={disabled}
            aria-label={`Dígito ${i + 1} de ${PIN_LENGTH}`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errId : undefined}
            onChange={(e) => onInput(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            onPaste={onPaste}
            onFocus={(e) => e.currentTarget.select()}
          />
        ))}
      </div>
      <button type="button" className="kv-pin-toggle" onClick={() => setShow((s) => !s)} aria-pressed={show} disabled={disabled}>
        {show ? 'Ocultar' : 'Mostrar'}
      </button>
      <p id={errId} className="kv-pin-error" role={error ? 'alert' : undefined}>
        {error ?? ''}
      </p>
    </div>
  );
}
