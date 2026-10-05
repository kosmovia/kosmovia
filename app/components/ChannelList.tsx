'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Channel, Community, User } from '../types';
import { AvatarFace } from './AvatarFace';
import { CommunityCard } from './CommunityCard';
import { IconChevronDown, IconGear, IconLock, IconPlus } from './Icons';
import { groupChannels } from './channelUtils';

interface ChannelListProps {
  community: Community;
  activeChannelId: string;
  onSelectChannel: (id: string) => void;
  currentUser: User;
  onOpenProfile?: () => void;
  /** Con `categoryId`, es el "+" de esa categoría. */
  onOpenCreateChannel?: (categoryId?: string | null) => void;
  /** Dueño o admin de la comunidad activa. */
  isOwner?: boolean;
  onOpenSettings?: () => void;
  /** Dueño o admin: abre "Configurar canal" (descripción y borrar). */
  onOpenChannelSettings?: (channelId: string) => void;
  onNotice?: (text: string) => void;
}

export function ChannelList({
  community,
  activeChannelId,
  onSelectChannel,
  currentUser,
  onOpenProfile,
  onOpenCreateChannel,
  isOwner = false,
  onOpenSettings,
  onOpenChannelSettings,
  onNotice,
}: ChannelListProps) {
  const groups = useMemo(
    () => groupChannels(community.channels, community.categories ?? []),
    [community.channels, community.categories]
  );

  // Categorías colapsadas, por comunidad, en este navegador.
  const storageKey = `kosmovia:categorias-colapsadas:${community.id}`;
  const [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setCollapsed(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      setCollapsed([]);
    }
  }, [storageKey]);
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* sin almacenamiento: vale solo en esta sesión */
      }
      return next;
    });

  const renderChannel = (channel: Channel) => {
    const isActive = channel.id === activeChannelId;
    return (
      <div key={channel.id} className="kv-channel-item">
        <button
          type="button"
          className={`channel-item-btn ${isActive ? 'active' : ''}`}
          aria-current={isActive ? 'page' : undefined}
          onClick={() => onSelectChannel(channel.id)}
        >
          {channel.emoji ? (
            <span className="kv-channel-emoji" aria-hidden="true">
              {channel.emoji}
            </span>
          ) : (
            <span className="channel-hash">#</span>
          )}
          <span className="kv-channel-name">{channel.name}</span>
          {channel.visibility === 'private' ? (
            <span className="kv-channel-lock" title="Canal privado: solo admins y moderadores" role="img" aria-label="Canal privado">
              <IconLock size={12} />
            </span>
          ) : null}
        </button>
        {isOwner && onOpenChannelSettings ? (
          <button
            type="button"
            className="kv-channel-gear"
            onClick={() => onOpenChannelSettings(channel.id)}
            aria-label={`Configurar el canal ${channel.name}`}
            title="Configurar canal"
          >
            <IconGear size={14} />
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <aside className="channel-sidebar" aria-label="Canales">
      <div className="community-header">
        <h2 className="community-title">{community.name}</h2>
      </div>

      <CommunityCard
        community={community}
        isOwner={isOwner}
        onOpenSettings={() => onOpenSettings?.()}
        onNotice={(text) => onNotice?.(text)}
      />
      <div className="channel-list-scroll">
        {groups.map((group) => {
          if (!group.category) return <div key="sin-categoria">{group.channels.map(renderChannel)}</div>;
          const cat = group.category;
          const isCollapsed = collapsed.includes(cat.id);
          const listId = `kv-cat-${cat.id}`;
          return (
            <section key={cat.id} className="kv-category" aria-label={cat.name}>
              <div className="channel-category-row">
                <button
                  type="button"
                  className="kv-category-toggle"
                  onClick={() => toggle(cat.id)}
                  aria-expanded={!isCollapsed}
                  aria-controls={listId}
                >
                  <span className={`kv-category-chevron ${isCollapsed ? 'collapsed' : ''}`}>
                    <IconChevronDown size={12} />
                  </span>
                  <span className="channel-category-label">{cat.name}</span>
                </button>
                {onOpenCreateChannel && isOwner ? (
                  <button
                    type="button"
                    className="btn-add-channel"
                    onClick={() => onOpenCreateChannel(cat.id)}
                    title={`Crear un canal en ${cat.name}`}
                    aria-label={`Crear un canal en ${cat.name}`}
                  >
                    <IconPlus size={14} />
                  </button>
                ) : null}
              </div>
              <div id={listId} hidden={isCollapsed}>
                {group.channels.map(renderChannel)}
              </div>
            </section>
          );
        })}
        {onOpenCreateChannel && isOwner && (community.categories ?? []).length === 0 ? (
          <button type="button" className="kv-add-channel-plain" onClick={() => onOpenCreateChannel(null)}>
            <IconPlus size={14} /> Crear canal
          </button>
        ) : null}
      </div>

      <button
        type="button"
        className="user-profile-bar"
        onClick={onOpenProfile}
        title="Ver y editar mi perfil"
      >
        <div className="user-avatar-badge">
          <AvatarFace avatar={currentUser.avatar} name={currentUser.displayName} />
          <span className="status-dot" />
        </div>
        <div className="user-info">
          <span className="user-name">{currentUser.displayName}</span>
          <span className="user-tag">{currentUser.username}</span>
        </div>
        <span className="user-gear-icon">⚙️</span>
      </button>
    </aside>
  );
}
