'use client';

import React, { useEffect, useState } from 'react';
import { Community, User } from '../types';
import type { UpdateChannelInput } from '../services/communityService';
import { AvatarFace } from './AvatarFace';
import { CategorySelect, EmojiField, VisibilityToggle } from './ChannelFields';
import { IconArrowDown, IconArrowUp } from './Icons';
import { groupChannels, sortCategories } from './channelUtils';
import { CommunityPhotoPicker } from './CommunityPhotoPicker';

type AssignableRole = 'admin' | 'moderator' | 'member';
type MyRole = User['role'];

interface CommunitySettingsModalProps {
  community: Community;
  isOpen: boolean;
  onClose: () => void;
  /** Tu rol en esta comunidad: owner ve todo; admin, roles de moderador/miembro y canales. */
  myRole: MyRole;
  currentUserId: string;
  onSaveImage: (image: string | null) => Promise<boolean>;
  /** Dueño o admin: guarda la descripción de la comunidad; "" la quita. */
  onSaveDescription: (description: string) => Promise<boolean>;
  onChangeRole: (profileId: string, role: AssignableRole) => Promise<boolean>;
  onDeleteChannel: (channelId: string) => Promise<boolean>;
  /** Guarda la descripción (tema) de un canal; "" la quita. */
  onSaveChannelTopic: (channelId: string, topic: string) => Promise<boolean>;
  onDeleteCommunity: () => Promise<boolean>;
  /** Emoji, categoría o visibilidad de un canal. */
  onUpdateChannel: (channelId: string, patch: UpdateChannelInput) => Promise<boolean>;
  /** Sube (-1) o baja (1) un canal dentro de su categoría. */
  onMoveChannel: (channelId: string, dir: -1 | 1) => Promise<boolean>;
  onCreateCategory: (name: string) => Promise<boolean>;
  onRenameCategory: (categoryId: string, name: string) => Promise<boolean>;
  onMoveCategory: (categoryId: string, dir: -1 | 1) => Promise<boolean>;
  onDeleteCategory: (categoryId: string) => Promise<boolean>;
}

const ROLE_LABEL: Record<string, string> = { owner: 'Dueño', admin: 'Admin', moderator: 'Moderador', member: 'Miembro', builder: 'Miembro' };

/**
 * Configuración de la comunidad (dueño o admin), con el estilo de los modales:
 * General (descripción y foto) · Roles · Canales · Borrar (solo el dueño). El servidor vuelve a revisar
 * cada permiso; aquí solo se muestran las opciones que tu rol puede usar.
 */
export function CommunitySettingsModal({
  community,
  isOpen,
  onClose,
  myRole,
  currentUserId,
  onSaveImage,
  onSaveDescription,
  onChangeRole,
  onDeleteChannel,
  onSaveChannelTopic,
  onDeleteCommunity,
  onUpdateChannel,
  onMoveChannel,
  onCreateCategory,
  onRenameCategory,
  onMoveCategory,
  onDeleteCategory,
}: CommunitySettingsModalProps) {
  const isOwner = myRole === 'owner';
  const [tab, setTab] = useState<'general' | 'roles' | 'channels' | 'delete'>('general');
  const [image, setImage] = useState<string | null>(community.image ?? null);
  const [description, setDescription] = useState(community.description ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmChannel, setConfirmChannel] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState('');
  // Descripciones en edición (canal -> texto); sin entrada = sin cambios.
  const [topicDrafts, setTopicDrafts] = useState<Record<string, string>>({});
  // Categorías: nombre nuevo, renombres en edición y la que espera confirmación para borrarse.
  const [newCategory, setNewCategory] = useState('');
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [confirmCategory, setConfirmCategory] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setImage(community.image ?? null);
    setDescription(community.description ?? '');
    setTab('general');
    setConfirmChannel(null);
    setConfirmName('');
    setTopicDrafts({});
    setNewCategory('');
    setNameDrafts({});
    setConfirmCategory(null);
  }, [isOpen, community.id, community.image, community.description]);

  if (!isOpen) return null;
  const photoChanged = (image ?? null) !== (community.image ?? null);
  const descriptionChanged = description.trim() !== (community.description ?? '');

  /** Qué roles puede darle tu rol a esta persona (vacío = no puedes cambiarla). */
  const optionsFor = (member: User): AssignableRole[] => {
    if (member.id === currentUserId || member.role === 'owner') return [];
    if (isOwner) return ['admin', 'moderator', 'member'];
    if (myRole === 'admin' && member.role !== 'admin') return ['moderator', 'member'];
    return [];
  };

  const run = async (key: string, fn: () => Promise<boolean>) => {
    setBusy(key);
    const ok = await fn();
    setBusy(null);
    return ok;
  };

  const tabs: { id: typeof tab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'roles', label: 'Roles' },
    { id: 'channels', label: 'Canales' },
    ...(isOwner ? [{ id: 'delete' as const, label: 'Borrar' }] : []),
  ];

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Configuración de ${community.name}`}>
      <div className="modal-card profile-settings-card" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div className="settings-header-title">
            <h3 className="modal-title">Configuración</h3>
            <span className="user-tag">{community.name}</span>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>

        <div className="settings-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`settings-tab-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'general' && (
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label" htmlFor="kv-community-desc">
                Descripción
              </label>
              <textarea
                id="kv-community-desc"
                className="form-textarea"
                rows={3}
                maxLength={280}
                placeholder="Cuenta de qué trata la comunidad (opcional)"
                value={description}
                disabled={busy !== null}
                onChange={(e) => setDescription(e.target.value)}
              />
              <span className="form-hint kv-field-count" aria-live="polite">
                {description.length}/280
              </span>
            </div>
            <div className="modal-actions kv-actions-inline">
              <button
                type="button"
                className="btn-primary"
                disabled={!descriptionChanged || busy !== null}
                onClick={() => void run('description', () => onSaveDescription(description.trim()))}
              >
                {busy === 'description' ? 'Guardando…' : 'Guardar descripción'}
              </button>
            </div>

            {isOwner ? (
              <>
                <hr className="kv-settings-sep" />
                <CommunityPhotoPicker name={community.name} value={image} onChange={setImage} />
                <div className="modal-actions kv-actions-inline">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!photoChanged || busy !== null}
                    onClick={() => void run('photo', () => onSaveImage(image))}
                  >
                    {busy === 'photo' ? 'Guardando…' : 'Guardar foto'}
                  </button>
                </div>
              </>
            ) : (
              <p className="settings-tab-desc">Solo el dueño cambia la foto de la comunidad.</p>
            )}
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Cerrar
              </button>
            </div>
          </div>
        )}

        {tab === 'roles' && (
          <div className="modal-body">
            <p className="settings-tab-desc">
              {isOwner
                ? 'Como dueño puedes nombrar admins, moderadores y miembros.'
                : 'Como admin puedes cambiar a moderadores y miembros. Solo el dueño nombra admins.'}
            </p>
            <div className="kv-settings-list">
              {community.members.map((m) => {
                const options = optionsFor(m);
                return (
                  <div key={m.id} className="kv-settings-row">
                    <div className="member-avatar" style={{ width: 34, height: 34, flexShrink: 0 }}>
                      <AvatarFace avatar={m.avatar} name={m.displayName} />
                    </div>
                    <div className="kv-settings-row-text">
                      <span className="member-name">{m.displayName}</span>
                      <span className="member-tag">{m.username}</span>
                    </div>
                    {options.length === 0 ? (
                      <span className={`role-badge ${m.role ?? 'member'}`}>{ROLE_LABEL[m.role ?? 'member']}</span>
                    ) : (
                      <select
                        className="form-select kv-role-select"
                        aria-label={`Rol de ${m.username}`}
                        value={m.role === 'admin' || m.role === 'moderator' ? m.role : 'member'}
                        disabled={busy !== null}
                        onChange={(e) => void run(`role:${m.id}`, () => onChangeRole(m.id, e.target.value as AssignableRole))}
                      >
                        {(['admin', 'moderator', 'member'] as AssignableRole[])
                          .filter((r) => options.includes(r) || r === m.role)
                          .map((r) => (
                            <option key={r} value={r} disabled={!options.includes(r)}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'channels' && (
          <div className="modal-body">
            <h4 className="kv-settings-subtitle">Categorías</h4>
            <p className="settings-tab-desc">
              Agrupan los canales en la barra lateral. Al borrar una categoría, sus canales quedan sin categoría.
            </p>
            <div className="kv-settings-list">
              {sortCategories(community.categories ?? []).map((cat, idx, all) => {
                const draftName = nameDrafts[cat.id] ?? cat.name;
                const renamed = draftName.trim() !== cat.name && draftName.trim().length > 0;
                const saveName = () =>
                  void run(`catname:${cat.id}`, () => onRenameCategory(cat.id, draftName.trim())).then(
                    (ok) => ok && setNameDrafts((prev) => { const { [cat.id]: _gone, ...rest } = prev; return rest; }),
                  );
                return (
                  <div key={cat.id} className="kv-settings-row kv-category-row">
                    <input
                      type="text"
                      className="form-input"
                      maxLength={40}
                      aria-label={`Nombre de la categoría ${cat.name}`}
                      value={draftName}
                      disabled={busy !== null}
                      onChange={(e) => setNameDrafts((prev) => ({ ...prev, [cat.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && renamed && busy === null) {
                          e.preventDefault();
                          saveName();
                        }
                      }}
                    />
                    {renamed ? (
                      <button type="button" className="btn-primary kv-topic-save" disabled={busy !== null} onClick={saveName}>
                        {busy === `catname:${cat.id}` ? 'Guardando…' : 'Guardar'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="kv-icon-btn"
                      aria-label={`Subir la categoría ${cat.name}`}
                      title="Subir"
                      disabled={busy !== null || idx === 0}
                      onClick={() => void run(`catmove:${cat.id}`, () => onMoveCategory(cat.id, -1))}
                    >
                      <IconArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      className="kv-icon-btn"
                      aria-label={`Bajar la categoría ${cat.name}`}
                      title="Bajar"
                      disabled={busy !== null || idx === all.length - 1}
                      onClick={() => void run(`catmove:${cat.id}`, () => onMoveCategory(cat.id, 1))}
                    >
                      <IconArrowDown size={14} />
                    </button>
                    {confirmCategory === cat.id ? (
                      <span style={{ display: 'flex', gap: 6 }}>
                        <button type="button" className="btn-secondary" onClick={() => setConfirmCategory(null)} disabled={busy !== null}>
                          No
                        </button>
                        <button
                          type="button"
                          className="kv-danger-btn"
                          disabled={busy !== null}
                          onClick={() => void run(`catdel:${cat.id}`, () => onDeleteCategory(cat.id)).then((ok) => ok && setConfirmCategory(null))}
                        >
                          {busy === `catdel:${cat.id}` ? 'Borrando…' : 'Sí, borrar'}
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="kv-danger-btn ghost" onClick={() => setConfirmCategory(cat.id)} disabled={busy !== null}>
                        Borrar
                      </button>
                    )}
                  </div>
                );
              })}
              <form
                className="kv-topic-edit"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = newCategory.trim();
                  if (!name || busy !== null) return;
                  void run('catnew', () => onCreateCategory(name)).then((ok) => ok && setNewCategory(''));
                }}
              >
                <input
                  type="text"
                  className="form-input"
                  maxLength={40}
                  placeholder="Nueva categoría (ej: Main Deck)"
                  aria-label="Nombre de la nueva categoría"
                  value={newCategory}
                  disabled={busy !== null}
                  onChange={(e) => setNewCategory(e.target.value)}
                />
                <button type="submit" className="btn-primary kv-topic-save" disabled={!newCategory.trim() || busy !== null}>
                  {busy === 'catnew' ? 'Creando…' : 'Crear'}
                </button>
              </form>
            </div>

            <hr className="kv-settings-sep" />
            <h4 className="kv-settings-subtitle">Canales</h4>
            <p className="settings-tab-desc">
              Cambia la descripción, el emoji, la categoría, el orden y la visibilidad de cada canal. Borrar un canal borra todos sus mensajes; #general no se puede borrar.
            </p>
            <div className="kv-settings-list">
              {groupChannels(community.channels, community.categories ?? []).flatMap((group) =>
                group.channels.map((ch, chIdx) => {
                const draft = topicDrafts[ch.id] ?? ch.topic ?? '';
                const topicChanged = draft.trim() !== (ch.topic ?? '');
                const lockedPublic = ch.name === 'general' || ch.type === 'payments';
                return (
                <div key={ch.id} className="kv-settings-row kv-channel-row">
                  <div className="kv-channel-row-top">
                  {ch.emoji ? <span aria-hidden="true">{ch.emoji}</span> : <span className="channel-hash">#</span>}
                  <div className="kv-settings-row-text">
                    <span className="member-name">{ch.name}</span>
                  </div>
                  <button
                    type="button"
                    className="kv-icon-btn"
                    aria-label={`Subir el canal ${ch.name}`}
                    title="Subir"
                    disabled={busy !== null || chIdx === 0}
                    onClick={() => void run(`chmove:${ch.id}`, () => onMoveChannel(ch.id, -1))}
                  >
                    <IconArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    className="kv-icon-btn"
                    aria-label={`Bajar el canal ${ch.name}`}
                    title="Bajar"
                    disabled={busy !== null || chIdx === group.channels.length - 1}
                    onClick={() => void run(`chmove:${ch.id}`, () => onMoveChannel(ch.id, 1))}
                  >
                    <IconArrowDown size={14} />
                  </button>
                  {ch.name === 'general' ? (
                    <span className="member-tag">Protegido</span>
                  ) : confirmChannel === ch.id ? (
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="btn-secondary" onClick={() => setConfirmChannel(null)} disabled={busy !== null}>
                        No
                      </button>
                      <button
                        type="button"
                        className="kv-danger-btn"
                        disabled={busy !== null}
                        onClick={() =>
                          void run(`ch:${ch.id}`, () => onDeleteChannel(ch.id)).then((ok) => ok && setConfirmChannel(null))
                        }
                      >
                        {busy === `ch:${ch.id}` ? 'Borrando…' : 'Sí, borrar'}
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="kv-danger-btn ghost" onClick={() => setConfirmChannel(ch.id)}>
                      Borrar
                    </button>
                  )}
                  </div>
                  <div className="kv-topic-edit">
                    <input
                      type="text"
                      className="form-input"
                      maxLength={200}
                      placeholder="Descripción del canal (opcional)"
                      aria-label={`Descripción de #${ch.name}`}
                      value={draft}
                      disabled={busy !== null}
                      onChange={(e) => setTopicDrafts((prev) => ({ ...prev, [ch.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && topicChanged && busy === null) {
                          e.preventDefault();
                          void run(`topic:${ch.id}`, () => onSaveChannelTopic(ch.id, draft.trim())).then(
                            (ok) => ok && setTopicDrafts((prev) => { const { [ch.id]: _gone, ...rest } = prev; return rest; }),
                          );
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn-primary kv-topic-save"
                      disabled={!topicChanged || busy !== null}
                      onClick={() =>
                        void run(`topic:${ch.id}`, () => onSaveChannelTopic(ch.id, draft.trim())).then(
                          (ok) => ok && setTopicDrafts((prev) => { const { [ch.id]: _gone, ...rest } = prev; return rest; }),
                        )
                      }
                    >
                      {busy === `topic:${ch.id}` ? 'Guardando…' : 'Guardar'}
                    </button>
                  </div>
                  <div className="kv-channel-controls">
                    <EmojiField value={ch.emoji ?? null} disabled={busy !== null} onChange={(emoji) => void run(`emoji:${ch.id}`, () => onUpdateChannel(ch.id, { emoji }))} />
                    <CategorySelect
                      value={ch.categoryId ?? null}
                      categories={community.categories ?? []}
                      disabled={busy !== null}
                      ariaLabel={`Categoría de #${ch.name}`}
                      onChange={(categoryId) => void run(`cat:${ch.id}`, () => onUpdateChannel(ch.id, { categoryId }))}
                    />
                    <VisibilityToggle
                      name={`vis-${ch.id}`}
                      value={ch.visibility ?? 'public'}
                      disabled={busy !== null || lockedPublic}
                      onChange={(visibility) => void run(`vis:${ch.id}`, () => onUpdateChannel(ch.id, { visibility }))}
                    />
                  </div>
                </div>
                );
              }))}
            </div>
          </div>
        )}

        {tab === 'delete' && isOwner && (
          <div className="modal-body">
            <div className="kv-danger-zone">
              <strong>Borrar {community.name}</strong>
              <p className="settings-tab-desc" style={{ margin: 0 }}>
                Se borran sus canales y todos los mensajes, y nadie más podrá entrar. No se puede deshacer. Los pagos en la red no se
                tocan.
              </p>
              <label className="form-label" htmlFor="kv-confirm-name">
                Escribe <b>{community.name}</b> para confirmar
              </label>
              <input
                id="kv-confirm-name"
                type="text"
                className="form-input"
                autoComplete="off"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
              />
              <button
                type="button"
                className="kv-danger-btn"
                disabled={confirmName.trim() !== community.name || busy !== null}
                onClick={() => void run('delete', onDeleteCommunity).then((ok) => ok && onClose())}
              >
                {busy === 'delete' ? 'Borrando…' : 'Borrar comunidad para siempre'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
