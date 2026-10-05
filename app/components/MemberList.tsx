'use client';

import React from 'react';
import { User } from '../types';
import { AvatarFace } from './AvatarFace';
import { IconClose } from './Icons';

interface MemberListProps {
  members: User[];
  isOpen: boolean;
  /** Cierra el panel (botón X del encabezado). */
  onClose?: () => void;
  /** Abre la tarjeta de perfil del miembro. */
  onOpenProfile?: (user: User) => void;
}

export function MemberList({ members, isOpen, onClose, onOpenProfile }: MemberListProps) {
  // Cada fila abre el perfil, con mouse o teclado.
  const open = (member: User) => ({
    role: 'button' as const,
    tabIndex: 0,
    style: { cursor: 'pointer' },
    title: `Ver perfil de ${member.username}`,
    onClick: () => onOpenProfile?.(member),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpenProfile?.(member);
      }
    },
  });
  if (!isOpen) return null;

  const onlineMembers = members.filter((m) => m.isOnline);
  const offlineMembers = members.filter((m) => !m.isOnline);

  return (
    <aside className="member-sidebar kv-docked-panel" aria-label="Miembros de la comunidad">
      <div className="kv-panel-head">
        <span className="kv-panel-title">Miembros</span>
        {onClose ? (
          <button type="button" className="wallet-close-btn" onClick={onClose} aria-label="Cerrar miembros">
            <IconClose size={18} />
          </button>
        ) : null}
      </div>
      <div className="kv-panel-body">
      <div className="member-section-header">
        EN LÍNEA — {onlineMembers.length}
      </div>
      <div className="member-list">
        {onlineMembers.map((member) => (
          <div key={member.id} className="member-item" {...open(member)}>
            <div className="member-avatar-wrapper">
              <div className="member-avatar">
                <AvatarFace avatar={member.avatar} name={member.displayName} />
              </div>
              <span className="member-status-dot online" />
            </div>
            <div className="member-details">
              <div className="member-name-row">
                <span className="member-name">{member.displayName}</span>
                {member.role && member.role !== 'member' && (
                  <span className={`role-badge ${member.role}`}>
                    {{ owner: 'dueño', admin: 'admin', moderator: 'moderador', builder: 'builder' }[member.role] ?? member.role}
                  </span>
                )}
              </div>
              <span className="member-tag">{member.username}</span>
            </div>
          </div>
        ))}
      </div>

      {offlineMembers.length > 0 && (
        <>
          <div className="member-section-header">
            DESCONECTADOS — {offlineMembers.length}
          </div>
          <div className="member-list">
            {offlineMembers.map((member) => (
              <div key={member.id} className="member-item offline" {...open(member)}>
                <div className="member-avatar-wrapper">
                  <div className="member-avatar">
                    <AvatarFace avatar={member.avatar} name={member.displayName} />
                  </div>
                  <span className="member-status-dot offline" />
                </div>
                <div className="member-details">
                  <div className="member-name-row">
                    <span className="member-name">{member.displayName}</span>
                  </div>
                  <span className="member-tag">{member.username}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      </div>
    </aside>
  );
}
