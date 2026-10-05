'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Community } from '../types';
import { CommunityAvatar } from './CommunityAvatar';
import { IconBellOff, IconDots, IconGear, IconLink, IconLogout } from './Icons';

interface CommunityCardProps {
  community: Community;
  /** Dueño o admin: ve "Configuración"; si no, "Opciones". */
  isOwner: boolean;
  onOpenSettings: () => void;
  onNotice: (text: string) => void;
}

/**
 * Arriba de los canales: la foto de la comunidad (con el relieve "portal"),
 * una descripción corta y botones chicos: Compartir y Configuración/Opciones.
 */
export function CommunityCard({ community, isOwner, onOpenSettings, onNotice }: CommunityCardProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!optionsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOptionsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOptionsOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [optionsOpen]);

  const share = async () => {
    const link = `${window.location.origin}/plataforma?c=${encodeURIComponent(community.slug)}`;
    try {
      await navigator.clipboard.writeText(link);
      onNotice(`Link de invitación copiado: quien lo abra entra a ${community.name}.`);
    } catch {
      onNotice(`Copia este link para invitar: ${link}`);
    }
  };

  const members = community.members?.length ?? 0;

  return (
    <div className="kv-community-card">
      <div className="kv-community-card-top">
        <CommunityAvatar name={community.name} icon={community.icon} image={community.image} size={60} featured />
        <div className="kv-community-card-text">
          {community.description ? (
            <p className="kv-community-desc" title={community.description}>
              {community.description}
            </p>
          ) : isOwner ? (
            <button type="button" className="kv-community-desc kv-desc-add" onClick={onOpenSettings}>
              Agregar descripción
            </button>
          ) : (
            <p className="kv-community-desc">Todavía no tiene descripción.</p>
          )}
          <span className="kv-community-meta">
            {members} {members === 1 ? 'miembro' : 'miembros'}
          </span>
        </div>
      </div>
      <div className="kv-community-actions" ref={boxRef}>
        <button type="button" className="kv-chip" onClick={() => void share()} title="Copiar link de invitación">
          <IconLink size={14} /> Compartir
        </button>
        {isOwner ? (
          <button type="button" className="kv-chip" onClick={onOpenSettings} title="Configuración de la comunidad">
            <IconGear size={14} /> Configurar
          </button>
        ) : (
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="kv-chip"
              onClick={() => setOptionsOpen((prev) => !prev)}
              aria-expanded={optionsOpen}
              aria-haspopup="menu"
            >
              <IconDots size={14} /> Opciones
            </button>
            {optionsOpen ? (
              <div className="kv-menu" role="menu" aria-label="Opciones de la comunidad">
                <button type="button" role="menuitem" className="kv-menu-item" disabled title="Próximamente">
                  <IconBellOff size={15} /> Silenciar · próximamente
                </button>
                <button type="button" role="menuitem" className="kv-menu-item" disabled title="Próximamente">
                  <IconLogout size={15} /> Salir de la comunidad · próximamente
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
