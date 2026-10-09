'use client';

import React, { useEffect, useRef, useState } from 'react';
import { IconCoin, IconImage, IconPaperclip, IconPlus } from './Icons';

/**
 * Botón [+] a la izquierda del mensaje, como en Towns: cobro B2B y, pronto,
 * foto y archivo. Deja el campo de texto limpio.
 */
export function ComposerPlus({ onInvoice }: { onInvoice?: () => void }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="kv-composer-icon kv-composer-plus"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Adjuntar o cobrar"
        aria-expanded={open}
        aria-haspopup="menu"
        title="Adjuntar o cobrar"
      >
        <IconPlus size={20} />
      </button>
      {open ? (
        <div className="kv-menu kv-menu-up" role="menu" aria-label="Adjuntar">
          <button type="button" role="menuitem" className="kv-menu-item" disabled title="Próximamente">
            <IconImage size={16} /> Foto · próximamente
          </button>
          <button type="button" role="menuitem" className="kv-menu-item" disabled title="Próximamente">
            <IconPaperclip size={16} /> Archivo (hasta 1 MB) · próximamente
          </button>
          {onInvoice ? (
            <button
              type="button"
              role="menuitem"
              className="kv-menu-item"
              onClick={() => {
                setOpen(false);
                onInvoice();
              }}
            >
              <IconCoin size={16} /> Cobro en USDC
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
