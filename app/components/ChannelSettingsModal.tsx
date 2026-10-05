'use client';

import React, { useEffect, useState } from 'react';
import { Category, Channel } from '../types';
import type { UpdateChannelInput } from '../services/communityService';
import { CategorySelect, EmojiField, VisibilityToggle } from './ChannelFields';

interface ChannelSettingsModalProps {
  /** Canal a configurar; null = cerrado. */
  channel: Channel | null;
  onClose: () => void;
  /** Guarda los cambios (descripción, emoji, categoría, visibilidad). */
  onUpdate: (channelId: string, patch: UpdateChannelInput) => Promise<boolean>;
  categories?: Category[];
  onDelete: (channelId: string) => Promise<boolean>;
}

const TOPIC_MAX = 200;

/**
 * "Configurar canal" (dueño o admin): descripción, emoji, categoría, visibilidad y borrar.
 * El servidor vuelve a revisar el permiso; #general no se puede borrar.
 */
export function ChannelSettingsModal({ channel, onClose, onUpdate, categories = [], onDelete }: ChannelSettingsModalProps) {
  const [topic, setTopic] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [confirming, setConfirming] = useState(false);

  const channelId = channel?.id;
  const savedTopic = channel?.topic ?? '';
  const savedEmoji = channel?.emoji ?? null;
  const savedCategory = channel?.categoryId ?? null;
  const savedVisibility = channel?.visibility ?? 'public';
  useEffect(() => {
    setTopic(savedTopic);
    setEmoji(savedEmoji);
    setCategoryId(savedCategory);
    setVisibility(savedVisibility);
    setConfirming(false);
  }, [channelId, savedTopic, savedEmoji, savedCategory, savedVisibility]);

  useEffect(() => {
    if (!channel) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [channel, onClose]);

  if (!channel) return null;
  const changed =
    topic.trim() !== savedTopic || emoji !== savedEmoji || categoryId !== savedCategory || visibility !== savedVisibility;
  // #general y los canales de comprobantes no pueden volverse privados.
  const lockedPublic = channel.name === 'general' || channel.type === 'payments';

  const save = async () => {
    const patch: UpdateChannelInput = {};
    if (topic.trim() !== savedTopic) patch.topic = topic.trim();
    if (emoji !== savedEmoji) patch.emoji = emoji;
    if (categoryId !== savedCategory) patch.categoryId = categoryId;
    if (visibility !== savedVisibility) patch.visibility = visibility;
    setBusy('save');
    const ok = await onUpdate(channel.id, patch);
    setBusy(null);
    if (ok) onClose();
  };

  const remove = async () => {
    setBusy('delete');
    const ok = await onDelete(channel.id);
    setBusy(null);
    if (ok) onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Configurar el canal ${channel.name}`}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div className="settings-header-title">
            <h3 className="modal-title">Configurar canal</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label" htmlFor="kv-channel-name">
              Nombre
            </label>
            <input id="kv-channel-name" type="text" className="form-input readonly" value={`#${channel.name}`} readOnly />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="kv-channel-topic">
              Descripción
            </label>
            <textarea
              id="kv-channel-topic"
              className="form-textarea"
              rows={3}
              maxLength={TOPIC_MAX}
              placeholder="De qué trata este canal (opcional)"
              value={topic}
              disabled={busy !== null}
              autoFocus
              onChange={(e) => setTopic(e.target.value)}
            />
            <span className="form-hint kv-field-count" aria-live="polite">
              {topic.length}/{TOPIC_MAX}
            </span>
          </div>
          <div className="form-group">
            <label className="form-label">Emoji</label>
            <EmojiField value={emoji} onChange={setEmoji} disabled={busy !== null} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="kv-channel-cat">
              Categoría
            </label>
            <CategorySelect id="kv-channel-cat" value={categoryId} onChange={setCategoryId} categories={categories} disabled={busy !== null} />
          </div>
          <div className="form-group">
            <label className="form-label">Visibilidad</label>
            <VisibilityToggle name="kv-channel-vis" value={visibility} onChange={setVisibility} disabled={busy !== null || lockedPublic} />
            {lockedPublic ? <span className="form-hint">Este canal siempre es público.</span> : null}
          </div>
          <div className="modal-actions kv-actions-inline">
            <button type="button" className="btn-primary" disabled={!changed || busy !== null} onClick={() => void save()}>
              {busy === 'save' ? 'Guardando…' : 'Guardar'}
            </button>
          </div>

          <hr className="kv-settings-sep" />
          {channel.name === 'general' ? (
            <p className="settings-tab-desc">#general es el canal principal y no se puede borrar.</p>
          ) : confirming ? (
            <div className="kv-danger-zone">
              <p className="settings-tab-desc" style={{ margin: 0 }}>
                Se borra #{channel.name} con todos sus mensajes. No se puede deshacer.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => setConfirming(false)} disabled={busy !== null}>
                  No
                </button>
                <button type="button" className="kv-danger-btn" onClick={() => void remove()} disabled={busy !== null}>
                  {busy === 'delete' ? 'Borrando…' : 'Sí, borrar canal'}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="kv-danger-btn ghost" onClick={() => setConfirming(true)} disabled={busy !== null}>
              Borrar canal
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
