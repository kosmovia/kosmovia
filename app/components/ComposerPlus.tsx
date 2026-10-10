'use client';

import React, { useEffect, useRef, useState } from 'react';
import { IconCoin, IconImage, IconPaperclip, IconPlus } from './Icons';

/**
 * Botón [+] del mensaje: fotos, PDF y cobros B2B.
 */
export function ComposerPlus({ onInvoice, onPhoto, onFile, disabled = false }: { onInvoice?: () => void; onPhoto?: () => void; onFile?: () => void; disabled?: boolean }) {
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
        disabled={disabled}
        aria-label="Adjuntar o cobrar"
        aria-expanded={open}
        aria-haspopup="menu"
        title="Adjuntar o cobrar"
      >
        <IconPlus size={20} />
      </button>
      {open ? (
        <div className="kv-menu kv-menu-up" role="menu" aria-label="Adjuntar">
          <button type="button" role="menuitem" className="kv-menu-item" disabled={disabled || !onPhoto} onClick={() => { setOpen(false); onPhoto?.(); }}>
            <IconImage size={16} /> Foto o imagen
          </button>
          <button type="button" role="menuitem" className="kv-menu-item" disabled={disabled || !onFile} onClick={() => { setOpen(false); onFile?.(); }}>
            <IconPaperclip size={16} /> Archivo PDF · hasta 5 MB
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
