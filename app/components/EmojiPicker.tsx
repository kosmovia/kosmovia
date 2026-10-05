'use client';

import React, { useEffect, useRef, useState } from 'react';
import { IconSmile } from './Icons';

/** Una selección corta de emojis: sin librerías pesadas. */
const EMOJIS = [
  '😀', '😂', '🤣', '😊', '😍', '🤩', '😎', '🤔', '😅', '😇', '🙃', '😉', '😢', '😭', '😡', '🤯',
  '🥳', '😴', '🤝', '🙏', '👏', '🙌', '👍', '👎', '👋', '💪', '✌️', '🤞', '👀', '🫡', '🫶', '❤️',
  '💚', '💙', '🔥', '✨', '⭐', '🌟', '🌌', '🚀', '🛸', '🪐', '🌙', '☀️', '⚡', '💡', '🎯', '✅',
  '❌', '⚠️', '❓', '💯', '🎉', '🎊', '🏆', '💸', '💰', '🪙', '📈', '📉', '🧾', '🔗', '📎', '📷',
  '🎨', '💻', '🛠️', '🔒', '🧠', '📣', '🗓️', '☕', '🍕', '🥤', '🎵', '🇧🇴', '🦙', '🌎', '🤖', '👾',
];

/** Botón 😊 del campo de mensaje: abre la grilla y agrega el emoji al texto. */
export function EmojiPicker({
  onPick,
  field,
  disabled,
}: {
  onPick: (emoji: string) => void;
  /** Modo campo (formularios): el botón muestra el emoji elegido (o "Elegir") y no el 😊 del chat. */
  field?: { value: string | null; label: string };
  disabled?: boolean;
}) {
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
        className={field ? 'kv-emoji-field-btn' : 'kv-composer-icon'}
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
        aria-label={field ? field.label : 'Emojis'}
        aria-expanded={open}
        title={field ? field.label : 'Emojis'}
      >
        {field ? field.value ? <span aria-hidden="true">{field.value}</span> : <IconSmile size={18} /> : <IconSmile size={20} />}
      </button>
      {open ? (
        <div className="kv-menu kv-emoji-grid" role="dialog" aria-label="Elegir emoji">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              className="kv-emoji"
              onClick={() => {
                onPick(e);
                setOpen(false);
              }}
              aria-label={`Agregar ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
