'use client';

import React, { useEffect, useState } from 'react';
import { User } from '../types';
import { AvatarFace } from './AvatarFace';
import { KosmoFrame } from './KosmoFrame';
import { SecuritySettings } from './SecuritySettings';

interface ProfileModalProps {
  user: User;
  isOpen: boolean;
  onClose: () => void;
  /** true si se guardó; false deja el modal abierto (el error lo muestra la página). */
  onSave: (updated: { displayName: string; bio: string }) => Promise<boolean> | void;
  stellarAddress?: string;
  /** Cerrar sesión (Pollar + cookie de core). */
  onLogout?: () => void;
}

export function ProfileModal({
  user,
  isOpen,
  onClose,
  onSave,
  stellarAddress = 'GD26UBYVEYYVVOVCMOLPMIKPWQRFV34LK3I7LHBNTUGYHYIKFMEREH2A',
  onLogout,
}: ProfileModalProps) {
  const [activeTab, setActiveTab] = useState<'profile' | 'security' | 'wallets' | 'kyc'>('profile');
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio || '');
  const [saving, setSaving] = useState(false);

  // Al abrir, partir de los datos actuales (el modal se monta antes de que lleguen los reales).
  useEffect(() => {
    if (!isOpen) return;
    setDisplayName(user.displayName);
    setBio(user.bio || '');
  }, [isOpen, user.displayName, user.bio]);


  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    const ok = await onSave({ displayName: displayName.trim(), bio: bio.trim() });
    setSaving(false);
    if (ok !== false) onClose();
  };

  // Nivel real cuando viene de core; sin él (modo demo) se ve como antes.
  const level = user.trustLevel;
  const levelText =
    level === undefined
      ? 'Nivel 2: Verificado en Stellar Testnet'
      : level === 2
        ? 'Nivel 2: Empresa verificada'
        : level === 1
          ? 'Nivel 1: Cuenta social verificada (X)'
          : 'Nivel 0: Wallet conectada';

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-card profile-settings-card" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div className="settings-header-title">
            <h3 className="modal-title">Configuración de Cuenta</h3>
            <span className="user-tag">{user.username}</span>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </header>

        {/* Pestañas de Navegación de Configuración */}
        <div className="settings-tabs">
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            👤 Mi Perfil
          </button>
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => setActiveTab('security')}
          >
            🔐 Seguridad
          </button>
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === 'wallets' ? 'active' : ''}`}
            onClick={() => setActiveTab('wallets')}
          >
            💳 Billeteras Vinculadas
          </button>
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === 'kyc' ? 'active' : ''}`}
            onClick={() => setActiveTab('kyc')}
          >
            🛡️ Identidad & KYC
          </button>
        </div>

        {/* Tab 1: Perfil */}
        {activeTab === 'profile' && (
          <form onSubmit={handleSubmit} className="modal-body">
            <div className="profile-banner">
              <KosmoFrame size={132} badge={<span className="profile-online-badge" />}>
                <AvatarFace avatar={user.avatar} name={displayName} />
              </KosmoFrame>
            </div>

            <div className="form-group">
              <label className="form-label">Identidad Kosmovia (@usuario)</label>
              <input
                type="text"
                className="form-input readonly"
                value={user.username}
                disabled
                title="El @usuario se cambia desde tu perfil en core"
              />
              <span className="form-hint">Tu identificador único. Se puede cambiar 1 vez cada 24 h.</span>
            </div>

            <div className="form-group">
              <label className="form-label">Nombre visible</label>
              <input
                type="text"
                className="form-input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={40}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Biografía</label>
              <textarea
                className="form-textarea"
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={280}
                placeholder="Contanos qué estás construyendo en Kosmovia..."
              />
            </div>

            <div className="modal-actions">
              {onLogout ? (
                <button type="button" className="kv-danger-btn ghost" style={{ marginRight: 'auto' }} onClick={onLogout}>
                  Cerrar sesión
                </button>
              ) : null}
              <button type="button" className="btn-secondary" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={saving || !displayName.trim()}>
                {saving ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        )}

        {/* Seguridad: PIN de pagos y límite diario */}
        {activeTab === 'security' && <SecuritySettings />}

        {/* Tab 2: Billeteras Vinculadas */}
        {activeTab === 'wallets' && (
          <div className="modal-body">
            <p className="settings-tab-desc">
              Conectá billeteras adicionales para importar activos, firmar transacciones o validar tu identidad Web3.
            </p>

            <div className="wallets-list">
              {/* Billetera Nativa Kosmovia */}
              <div className="wallet-connect-card active">
                <div className="wallet-card-header">
                  <div className="wallet-card-info">
                    <span className="wallet-card-icon">🌌</span>
                    <div>
                      <h4 className="wallet-card-name">Billetera Kosmovia (Pollar)</h4>
                      <span className="wallet-badge-primary">Principal · Stellar Testnet</span>
                    </div>
                  </div>
                  <span className="wallet-status-connected">Conectada</span>
                </div>
                <p className="wallet-card-address">{stellarAddress}</p>
              </div>

              {/* Billetera Externa: Freighter */}
              <div className="wallet-connect-card">
                <div className="wallet-card-header">
                  <div className="wallet-card-info">
                    <span className="wallet-card-icon">🚀</span>
                    <div>
                      <h4 className="wallet-card-name">Freighter Wallet</h4>
                      <span className="wallet-badge-sub">Billetera oficial de Stellar</span>
                    </div>
                  </div>
                  <button type="button" className="btn-connect-wallet" disabled title="Vincular una segunda wallet llega más adelante">
                    Próximamente
                  </button>
                </div>

              </div>

              {/* Billetera Externa: MetaMask / EVM */}
              <div className="wallet-connect-card">
                <div className="wallet-card-header">
                  <div className="wallet-card-info">
                    <span className="wallet-card-icon">🦊</span>
                    <div>
                      <h4 className="wallet-card-name">MetaMask / EVM</h4>
                      <span className="wallet-badge-sub">Ethereum, Arbitrum, Polygon</span>
                    </div>
                  </div>
                  <button type="button" className="btn-connect-wallet" disabled title="Las wallets EVM llegan más adelante">
                    Próximamente
                  </button>
                </div>

              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Cerrar
              </button>
            </div>
          </div>
        )}

        {/* Tab 3: Identidad & KYC */}
        {activeTab === 'kyc' && (
          <div className="modal-body">
            <div className="kyc-summary-box">
              <div className="kyc-badge-row">
                <span className="kyc-icon-badge">🛡️</span>
                <div>
                  <h4 className="kyc-title">Estado de Identidad</h4>
                  <span className="kyc-level-tag">{levelText}</span>
                </div>
              </div>
            </div>

            <div className="kyc-perks-list">
              <div className="kyc-perk-item">
                <span className="perk-check">✓</span>
                <div>
                  <strong>Activación de wallet patrocinada</strong>
                  <p>Pollar activa tu wallet y habilita USDC sin que pagues la reserva (según la configuración de la app).</p>
                </div>
              </div>

              <div className="kyc-perk-item">
                <span className="perk-check">✓</span>
                <div>
                  <strong>Pagos y cobros en USDC</strong>
                  <p>Habilitado para emitir cobros en USDC con comprobantes verificables.</p>
                </div>
              </div>

              <div className="kyc-perk-item">
                <span className="perk-check">✓</span>
                <div>
                  <strong>Entrar sin seed phrase</strong>
                  <p>Con Google, email o Freighter vía Pollar: nunca ves ni guardas claves privadas.</p>
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Entendido
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
