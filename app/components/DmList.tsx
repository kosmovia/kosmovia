'use client';

import React from 'react';
import { DmThread, User } from '../types';
import { AvatarFace } from './AvatarFace';
import { previewText } from '../lib/core/attachments-rules.ts';

interface DmListProps {
  threads: DmThread[];
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  currentUser: User;
  onOpenProfile?: () => void;
}

/** Columna del medio en "Mensajes directos": conversaciones, la más reciente primero. */
export function DmList({ threads, activeThreadId, onSelectThread, currentUser, onOpenProfile }: DmListProps) {
  const sorted = threads
    .slice()
    .sort((a, b) => (b.lastMessageAt ?? b.lastMessage?.createdAt ?? '').localeCompare(a.lastMessageAt ?? a.lastMessage?.createdAt ?? ''));

  return (
    <aside className="channel-sidebar" aria-label="Mensajes directos">
      <div className="community-header">
        <h2 className="community-title">Mensajes directos</h2>
      </div>

      <div className="channel-list-scroll">
        {sorted.length === 0 ? (
          <p className="kv-dm-empty">
            Aún no tienes conversaciones. Abre el perfil de alguien de tu comunidad y toca “Mensaje”.
          </p>
        ) : (
          sorted.map((t) => {
            const isActive = t.id === activeThreadId;
            const preview = t.lastMessage
              ? `${t.lastMessage.authorId === currentUser.id ? 'Tú: ' : ''}${t.lastMessage.content.startsWith('[COBRO_B2B:') ? 'Cobro en USDC' : previewText(t.lastMessage.content)}`
              : 'Sin mensajes todavía';
            return (
              <button
                key={t.id}
                type="button"
                className={`kv-dm-item ${isActive ? 'active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onSelectThread(t.id)}
              >
                <span className="kv-dm-avatar">
                  <AvatarFace avatar={t.other.avatar} name={t.other.displayName} />
                </span>
                <span className="kv-dm-text">
                  <span className={`kv-dm-name ${t.unread > 0 ? 'unread' : ''}`}>{t.other.displayName}</span>
                  <span className="kv-dm-preview">{preview}</span>
                </span>
                {t.unread > 0 ? (
                  <span className="kv-unread-badge" aria-label={`${t.unread} sin leer`}>
                    {t.unread > 9 ? '9+' : t.unread}
                  </span>
                ) : null}
              </button>
            );
          })
        )}
      </div>

      <button type="button" className="user-profile-bar" onClick={onOpenProfile} title="Ver y editar mi perfil">
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
