'use client';

import React from 'react';
import { Community, WalletTransaction } from '../types';
import { CommunityAvatar } from './CommunityAvatar';
import { IconChat, IconCompass, IconGrid, IconPlus } from './Icons';
import { ThemePicker, type ThemeId } from './ThemePicker';

interface CommunityBarProps {
  communities: Community[];
  activeCommunityId: string;
  onSelectCommunity: (id: string) => void;
  /** "+ Crear comunidad". */
  onCreateCommunity?: () => void;
  /** Abajo: billetera, notificaciones y tema (fuera del encabezado, como en Towns). */
  onOpenWallet?: () => void;
  isWalletOpen?: boolean;
  balanceUSDC?: number;
  notifications?: { transactions: WalletTransaction[]; unread: number; onOpen: () => void };
  theme?: ThemeId;
  onChangeTheme?: (theme: ThemeId) => void;
  /** Mensajes directos: abre la vista, y cuántos mensajes sin leer hay en total. */
  onOpenDms?: () => void;
  isDmsActive?: boolean;
  dmUnread?: number;
  /** Panel Aplicaciones (mini-apps). */
  onOpenApps?: () => void;
  isAppsOpen?: boolean;
}

/**
 * Barra izquierda: logo de Kosmovia, Mensajes directos y Explorar, las
 * comunidades donde estás (con su foto y el relieve "portal") y "+ Crear".
 * Abajo, el selector de tema (Mi Wallet y notificaciones van arriba a la derecha).
 */
export function CommunityBar({
  communities,
  activeCommunityId,
  onSelectCommunity,
  onCreateCommunity,
  onOpenWallet,
  isWalletOpen,
  balanceUSDC,
  notifications,
  theme = 'kosmovia',
  onChangeTheme,
  onOpenDms,
  isDmsActive = false,
  dmUnread = 0,
  onOpenApps,
  isAppsOpen = false,
}: CommunityBarProps) {
  return (
    <aside className="community-bar" aria-label="Comunidades">
      <button
        type="button"
        className="kv-rail-logo"
        title="Kosmovia"
        aria-label="Kosmovia: inicio"
        onClick={() => communities[0] && onSelectCommunity(communities[0].id)}
      >
        {/* Logo provisorio (segunda ronda, variación 2). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/kosmovia-icon.svg" alt="" width={48} height={48} className="kv-brand-img" />
      </button>

      <button
        type="button"
        className={`kv-rail-btn kv-rail-dm ${isDmsActive ? 'active' : ''}`}
        disabled={!onOpenDms}
        onClick={onOpenDms}
        aria-pressed={isDmsActive}
        title="Mensajes directos"
        aria-label={dmUnread > 0 ? `Mensajes directos: ${dmUnread} sin leer` : 'Mensajes directos'}
      >
        <IconChat size={20} />
        {dmUnread > 0 ? <span className="kv-unread-badge kv-rail-badge">{dmUnread > 9 ? '9+' : dmUnread}</span> : null}
      </button>
      <button type="button" className="kv-rail-btn" disabled title="Explorar comunidades · próximamente" aria-label="Explorar comunidades (próximamente)">
        <IconCompass size={20} />
      </button>

      <div className="divider" />

      <nav className="kv-rail-communities" aria-label="Tus comunidades">
        {communities.map((community) => {
          const isActive = !isDmsActive && community.id === activeCommunityId;
          return (
            <button
              key={community.id}
              type="button"
              title={community.name}
              aria-label={community.name}
              aria-current={isActive ? 'page' : undefined}
              className={`community-icon-btn kv-community-btn ${isActive ? 'active' : ''}`}
              onClick={() => onSelectCommunity(community.id)}
            >
              <CommunityAvatar name={community.name} icon={community.icon} image={community.image} size={46} />
            </button>
          );
        })}
        {onCreateCommunity ? (
          <button type="button" className="kv-rail-btn kv-rail-add" onClick={onCreateCommunity} title="Crear comunidad" aria-label="Crear comunidad">
            <IconPlus size={20} />
          </button>
        ) : null}
      </nav>

      {onOpenApps ? (
        <button
          type="button"
          className={`kv-rail-btn kv-rail-apps ${isAppsOpen ? 'active' : ''}`}
          onClick={onOpenApps}
          aria-pressed={isAppsOpen}
          title="Aplicaciones"
          aria-label="Aplicaciones"
        >
          <IconGrid size={20} />
        </button>
      ) : null}

      <div className="kv-rail-bottom">
        {onChangeTheme ? <ThemePicker theme={theme} onChange={onChangeTheme} /> : null}
      </div>
    </aside>
  );
}
