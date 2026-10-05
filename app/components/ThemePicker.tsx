'use client';

import React, { useEffect, useRef, useState } from 'react';
import { IconPalette } from './Icons';

export type ThemeId = 'kosmovia' | 'negro';

export const THEMES: { id: ThemeId; label: string; hint: string }[] = [
  { id: 'kosmovia', label: 'Kosmovia', hint: 'Azul noche con turquesa' },
  { id: 'negro', label: 'Negro', hint: 'Negro puro' },
];

/** Clave de localStorage; la usa también el script de layout.tsx que aplica el tema antes de pintar. */
export const THEME_STORAGE_KEY = 'kosmovia-theme';

export function isThemeId(value: unknown): value is ThemeId {
  return value === 'kosmovia' || value === 'negro';
}

interface ThemePickerProps {
  theme: ThemeId;
  onChange: (theme: ThemeId) => void;
}

/** Botón "Tema" de la barra izquierda: abre un menú chico con los temas disponibles. */
export function ThemePicker({ theme, onChange }: ThemePickerProps) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('touchstart', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('touchstart', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="kv-theme-box" ref={boxRef}>
      <button
        ref={buttonRef}
        type="button"
        className="kv-rail-btn"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Tema"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Tema"
      >
        <IconPalette size={20} />
      </button>
      {open ? (
        <div className="kv-theme-menu" role="menu" aria-label="Elegir tema">
          {THEMES.map((t) => {
            const current = t.id === theme;
            return (
              <button
                key={t.id}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                className={`kv-theme-option ${current ? 'current' : ''}`}
                onClick={() => {
                  onChange(t.id);
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
              >
                <span className={`kv-theme-swatch ${t.id}`} aria-hidden="true" />
                <span className="kv-theme-option-text">
                  <span className="kv-theme-option-name">{t.label}</span>
                  <span className="kv-theme-option-hint">{t.hint}</span>
                </span>
                <span className="kv-theme-check" aria-hidden="true">
                  {current ? '✓' : ''}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
