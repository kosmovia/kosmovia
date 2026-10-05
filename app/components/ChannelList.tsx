'use client';

import React from 'react';
import { Community, User } from '../types';
import { AvatarFace } from './AvatarFace';
import { CommunityCard } from './CommunityCard';
import { IconGear } from './Icons';

interface ChannelListProps {
  community: Community;
  activeChannelId: string;
  onSelectChannel: (id: string) => void;
  currentUser: User;
  onOpenProfile?: () => void;
  onOpenCreateChannel?: () => void;
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
        <div className="channel-category-row">
          <span className="channel-category-label">Canales de Texto</span>
          {onOpenCreateChannel && isOwner && (
            <button
              type="button"
              className="btn-add-channel"
              onClick={onOpenCreateChannel}
              title="Crear un canal nuevo"
            >
              +
            </button>
          )}
        </div>
        {community.channels.map((channel) => {
          const isActive = channel.id === activeChannelId;
          return (
            <div key={channel.id} className="kv-channel-item">
              <button
                type="button"
                className={`channel-item-btn ${isActive ? 'active' : ''}`}
                onClick={() => onSelectChannel(channel.id)}
              >
                <span className="channel-hash">#</span>
                <span>{channel.name}</span>
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
        })}
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
