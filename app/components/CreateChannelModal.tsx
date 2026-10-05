'use client';

import React, { useEffect, useState } from 'react';
import { Category } from '../types';
import { CategorySelect, EmojiField, VisibilityToggle } from './ChannelFields';

interface CreateChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** true si se creó; false deja el modal abierto (el error lo muestra la página). */
  onCreate: (
    name: string,
    topic: string,
    extra: { emoji: string | null; categoryId: string | null; visibility: 'public' | 'private' }
  ) => Promise<boolean> | void;
  categories?: Category[];
  /** Categoría del "+" que se tocó. */
  defaultCategoryId?: string | null;
}

export function CreateChannelModal({
  isOpen,
  onClose,
  onCreate,
  categories = [],
  defaultCategoryId = null,
}: CreateChannelModalProps) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(defaultCategoryId);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [saving, setSaving] = useState(false);

  // Cada vez que se abre, la categoría parte de la del "+" tocado.
  useEffect(() => {
    if (isOpen) setCategoryId(defaultCategoryId);
  }, [isOpen, defaultCategoryId]);

  if (!isOpen) return null;

  // Lo que acepta el servidor: minúsculas, números y guiones, hasta 30 (sin tildes ni espacios).
  const cleanName = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cleanName || saving) return;
    setSaving(true);
    const ok = await onCreate(cleanName, topic.trim().slice(0, 200), { emoji, categoryId, visibility });
    setSaving(false);
    if (ok === false) return;
    setName('');
    setTopic('');
    setEmoji(null);
    setVisibility('public');
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3 className="modal-title">Crear Nuevo Canal</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </header>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-group">
            <label className="form-label">Nombre del Canal</label>
            <div className="channel-input-wrapper" style={{ position: 'relative' }}>
              <input
                type="text"
                className="form-input"
                placeholder="ej: facturas-octubre"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <span className="form-hint">
              {cleanName && cleanName !== name.trim() ? `Se creará como #${cleanName}` : 'Solo letras minúsculas, números y guiones.'}
            </span>
          </div>

          <div className="form-group">
            <label className="form-label">Tópico o Descripción (Opcional)</label>
            <input
              type="text"
              className="form-input"
              placeholder="ej: Pagos B2B y facturación en Bolivia"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Emoji (opcional)</label>
            <EmojiField value={emoji} onChange={setEmoji} disabled={saving} />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="kv-new-channel-cat">
              Categoría
            </label>
            <CategorySelect id="kv-new-channel-cat" value={categoryId} onChange={setCategoryId} categories={categories} disabled={saving} />
          </div>

          <div className="form-group">
            <label className="form-label">Visibilidad</label>
            <VisibilityToggle name="kv-new-channel-vis" value={visibility} onChange={setVisibility} disabled={saving} />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={!cleanName || saving}
            >
              {saving ? 'Creando…' : 'Crear Canal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
