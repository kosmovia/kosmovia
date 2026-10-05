'use client';

import React from 'react';
import { Category } from '../types';
import { EmojiPicker } from './EmojiPicker';
import { sortCategories } from './channelUtils';

/** Emoji del canal: botón con el selector de emojis y "Quitar" para volver al "#". */
export function EmojiField({
  value,
  onChange,
  disabled,
  id,
}: {
  value: string | null;
  onChange: (emoji: string | null) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <div className="kv-emoji-field" id={id}>
      <EmojiPicker
        onPick={onChange}
        disabled={disabled}
        field={{ value, label: value ? `Emoji del canal: ${value}. Cambiar` : 'Elegir un emoji para el canal' }}
      />
      <span className="form-hint" style={{ margin: 0 }}>
        {value ? 'Se muestra en lugar del #' : 'Sin emoji: se usa #'}
      </span>
      {value ? (
        <button type="button" className="kv-mini-btn" onClick={() => onChange(null)} disabled={disabled}>
          Quitar
        </button>
      ) : null}
    </div>
  );
}

/** Lista de categorías para un <select> ("" = sin categoría). */
export function CategorySelect({
  value,
  onChange,
  categories,
  disabled,
  id,
  ariaLabel,
}: {
  value: string | null;
  onChange: (categoryId: string | null) => void;
  categories: Category[];
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
}) {
  return (
    <select
      id={id}
      className="form-select"
      aria-label={ariaLabel}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">Sin categoría</option>
      {sortCategories(categories).map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

/** Público / Privado (solo admins y moderadores). */
export function VisibilityToggle({
  value,
  onChange,
  disabled,
  name,
}: {
  value: 'public' | 'private';
  onChange: (v: 'public' | 'private') => void;
  disabled?: boolean;
  name: string;
}) {
  const opts: { v: 'public' | 'private'; label: string }[] = [
    { v: 'public', label: 'Público' },
    { v: 'private', label: 'Privado (solo admins y moderadores)' },
  ];
  return (
    <div className="kv-visibility" role="radiogroup" aria-label="Visibilidad del canal">
      {opts.map((o) => (
        <label key={o.v} className={`kv-visibility-opt ${value === o.v ? 'on' : ''}`}>
          <input type="radio" name={name} checked={value === o.v} disabled={disabled} onChange={() => onChange(o.v)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}
