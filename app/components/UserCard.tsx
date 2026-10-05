'use client';

import React, { useEffect, useState } from 'react';
import { User } from '../types';
import { profileService } from '../services';
import { AvatarFace } from './AvatarFace';
import { KosmoFrame } from './KosmoFrame';

interface UserCardProps {
  /** A quién se tocó (lo que ya se sabe: nombre, @usuario, avatar). */
  user: User | null;
  /** Su rol en la comunidad activa, si es miembro. */
  role?: User['role'];
  isSelf: boolean;
  onClose: () => void;
  onTransfer: (username: string) => void;
  /** Abre (o crea) un mensaje directo con esta persona. */
  onMessage?: (username: string) => void;
  onEditProfile: () => void;
}

const LEVELS: Record<0 | 1 | 2, string> = {
  0: 'Nivel 0 · Wallet conectada',
  1: 'Nivel 1 · Cuenta social verificada',
  2: 'Nivel 2 · Empresa verificada',
};

const ROLE_LABEL: Record<string, string> = { owner: 'Dueño', admin: 'Admin', moderator: 'Moderador', member: 'Miembro', builder: 'Builder' };

const desde = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('es-BO', { month: 'long', year: 'numeric' }) : null;

/**
 * Perfil corto de alguien del chat o de la lista de miembros, con el estilo de
 * los modales de la app. Completa los datos con el perfil público (bio, nivel,
 * X, wallet). Botones: Transferir (abre Mi Wallet con su @usuario) y Copiar.
 */
export function UserCard({ user, role, isSelf, onClose, onTransfer, onMessage, onEditProfile }: UserCardProps) {
  const [full, setFull] = useState<User | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setFull(null);
    setCopied(false);
    if (!user) return;
    let cancelled = false;
    profileService
      .getPublicProfile(user.username)
      .then((u) => {
        if (!cancelled && u) setFull(u);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user, onClose]);

  if (!user) return null;
  const u = { ...user, ...(full ?? {}) };
  const since = desde(u.memberSince);
  const wallet = u.wallet;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(u.username);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Perfil de ${u.username}`}>
      <div className="modal-card profile-settings-card" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div className="settings-header-title">
            <h3 className="modal-title">{u.displayName}</h3>
            <span className="user-tag">{u.username}</span>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Cerrar perfil">
            ✕
          </button>
        </header>

        <div className="modal-body">
          <div className="profile-banner">
            <KosmoFrame size={116}>
              <AvatarFace avatar={u.avatar} name={u.displayName} />
            </KosmoFrame>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 12 }}>
            {u.trustLevel !== undefined ? <span className="kyc-level-tag">{LEVELS[u.trustLevel]}</span> : null}
            {role ? <span className={`role-badge ${role}`}>{ROLE_LABEL[role] ?? role}</span> : null}
            {u.xHandle ? <span className="kyc-level-tag">𝕏 @{u.xHandle}</span> : null}
          </div>

          <p className="settings-tab-desc" style={{ textAlign: 'center' }}>
            {u.bio || (full ? 'Todavía no escribió su bio.' : 'Cargando perfil…')}
          </p>

          <div className="form-group">
            {since ? <span className="form-hint">En Kosmovia desde {since}</span> : null}
            {wallet ? (
              <span className="form-hint">
                Wallet{' '}
                <a href={`https://stellar.expert/explorer/testnet/account/${wallet}`} target="_blank" rel="noreferrer" className="wallet-explorer-link">
                  {wallet.slice(0, 6)}…{wallet.slice(-4)} ↗
                </a>
              </span>
            ) : null}
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={copy}>
              {copied ? '¡Copiado!' : 'Copiar @usuario'}
            </button>
            {isSelf ? (
              <button type="button" className="btn-primary" onClick={onEditProfile}>
                Editar perfil
              </button>
            ) : (
              <>
                {onMessage ? (
                  <button type="button" className="btn-secondary" onClick={() => onMessage(u.username)}>
                    Mensaje
                  </button>
                ) : null}
                <button type="button" className="btn-primary" onClick={() => onTransfer(u.username)}>
                  💸 Transferir
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
