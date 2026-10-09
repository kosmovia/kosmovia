'use client';

import React, { useEffect, useState } from 'react';
import { WalletTransaction } from '../types';
import { QrCode } from './QrCode';
import { IconClose } from './Icons';
import { RecipientPreview } from './RecipientPreview';
import { IconRefresh } from './Icons';

interface WalletDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  balanceUSDC: number;
  balanceXLM: number;
  publicKey: string;
  transactions: WalletTransaction[];
  /** true si el pago salió; false deja el formulario abierto (el error lo muestra la página). */
  onSend: (to: string, amount: number, asset: 'USDC' | 'XLM') => Promise<boolean> | void;
  /** Abrir directo en "Enviar" con un destinatario (desde el perfil). `nonce` cambia en cada pedido. */
  sendTo?: { recipient: string; nonce: number } | null;
  /** Botón ↻ (solo ícono) junto al saldo. */
  onRefresh?: () => void;
  isRefreshing?: boolean;
  /** En el panel derecho, sin fondo oscuro encima: el resto de la app se sigue usando. */
  docked?: boolean;
}

export function WalletDrawer({
  isOpen,
  onClose,
  balanceUSDC,
  balanceXLM,
  publicKey,
  transactions,
  onSend,
  sendTo,
  onRefresh,
  isRefreshing,
  docked = false,
}: WalletDrawerProps) {
  const [view, setView] = useState<'overview' | 'send' | 'receive'>('overview');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('0.01');
  const [asset, setAsset] = useState<'USDC' | 'XLM'>('USDC');
  const [copied, setCopied] = useState(false);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (!sendTo) return;
    setView('send');
    setRecipient(sendTo.recipient);
    setAmount('0.01');
  }, [sendTo]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard?.writeText(publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Espera el resultado real: vuelve al saldo solo si el pago salió.
  const handleSendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseFloat(amount.replace(',', '.'));
    if (isNaN(num) || num < 0.01 || isSending) return;
    setIsSending(true);
    const ok = await onSend(recipient.trim(), num, asset);
    setIsSending(false);
    if (ok !== false) {
      setView('overview');
      setRecipient('');
      setAmount('0.01');
    }
  };

  return (
    docked ? (
      <aside className="wallet-drawer kv-docked-panel" aria-label="Mi Wallet">
        <header className="kv-panel-head">
          <div className="wallet-header-title-row">
            <span className="kv-panel-title">Mi Wallet</span>
            <span className="wallet-testnet-pill">Testnet</span>
          </div>
          <button type="button" className="wallet-close-btn" onClick={onClose} aria-label="Cerrar billetera">
            <IconClose size={18} />
          </button>
        </header>

          <>
            {view === 'overview' && (
              <div className="wallet-drawer-body">
                <div className="wallet-balance-card">
                  <span className="wallet-balance-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    Saldo Disponible
                    {onRefresh ? (
                      <button
                        type="button"
                        className="kv-refresh-btn"
                        onClick={onRefresh}
                        disabled={isRefreshing}
                        aria-label="Actualizar saldo"
                        title="Actualizar saldo"
                      >
                        <span aria-hidden="true" className={isRefreshing ? 'kv-spin' : undefined} style={{ display: 'inline-flex' }}>
                          <IconRefresh size={16} />
                        </span>
                      </button>
                    ) : null}
                  </span>
                  <div className="wallet-balance-value">
                    {balanceUSDC.toFixed(2)} <span className="wallet-asset-tag">USDC</span>
                  </div>
                  <div className="wallet-balance-sub">
                    {balanceXLM.toFixed(2)} XLM para comisiones de red
                  </div>
                  <div className="wallet-key-bar">
                    <span className="wallet-key-text">
                      {publicKey.slice(0, 8)}...{publicKey.slice(-6)}
                    </span>
                    <button type="button" className="btn-copy-key" onClick={handleCopy}>
                      {copied ? 'Copiado!' : 'Copiar'}
                    </button>
                  </div>
                </div>

                <div className="wallet-quick-actions">
                  <button
                    type="button"
                    className="btn-wallet-action primary"
                    onClick={() => setView('send')}
                  >
                    ↗ Enviar
                  </button>
                  <button
                    type="button"
                    className="btn-wallet-action secondary"
                    onClick={() => setView('receive')}
                  >
                    ↙ Recibir
                  </button>
                </div>

                <div className="wallet-tx-section">
                  <h3 className="wallet-tx-title">Actividad Reciente</h3>
                  <div className="wallet-tx-list">
                    {transactions.length === 0 ? (
                      <p className="wallet-empty-text">No hay transferencias aún.</p>
                    ) : (
                      transactions.map((tx) => (
                        <div key={tx.id} className="wallet-tx-item">
                          <div className={`wallet-tx-icon ${tx.type}`}>
                            {tx.type === 'sent' ? '↗' : '↙'}
                          </div>
                          <div className="wallet-tx-info">
                            <span className="wallet-tx-user">
                              {tx.counterparty}
                              {tx.type === 'sent' && tx.unverified ? (
                                <span
                                  className="kv-unverified"
                                  tabIndex={0}
                                  title="Este pago no pasó por tu PIN. Si no lo hiciste tú, cambia tu PIN y avísanos."
                                  aria-label="Sin PIN. Este pago no pasó por tu PIN. Si no lo hiciste tú, cambia tu PIN y avísanos."
                                >
                                  ⚠ Sin PIN
                                </span>
                              ) : null}
                            </span>
                            <span className="wallet-tx-time">{tx.timestamp}</span>
                          </div>
                          <div className="wallet-tx-amount-col">
                            <span className={`wallet-tx-amount ${tx.type}`}>
                              {tx.type === 'sent' ? '-' : '+'}
                              {tx.amount} {tx.asset}
                            </span>
                            <a
                              href={`https://stellar.expert/explorer/testnet/tx/${tx.hash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="wallet-explorer-link"
                            >
                              Explorer ↗
                            </a>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {view === 'send' && (
              <div className="wallet-drawer-body">
                <button type="button" className="btn-wallet-back" onClick={() => setView('overview')}>
                  ← Volver al saldo
                </button>
                <h3 className="wallet-form-title">Enviar Activo en Stellar</h3>
                <form onSubmit={handleSendSubmit} className="wallet-form">
                  <div className="form-group">
                    <label className="form-label">Destinatario (@usuario o Address)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      placeholder="@usuario o G..."
                      required
                    />
                    <RecipientPreview value={recipient} selfWallet={publicKey} />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Monto</label>
                    <div className="amount-input-row">
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="form-input"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        required
                      />
                      <select
                        className="form-select"
                        value={asset}
                        onChange={(e) => setAsset(e.target.value as 'USDC' | 'XLM')}
                      >
                        <option value="USDC">USDC</option>
                        <option value="XLM">XLM</option>
                      </select>
                    </div>
                  </div>

                  <div className="wallet-fee-hint">
                    <span>Comisión de red:</span>
                    <span className="free-tag">≈ 0.00001 XLM</span>
                  </div>

                  <button
                    type="submit"
                    className="btn-login-submit"
                    disabled={isSending}
                  >
                    {isSending ? 'Enviando… (si usas Freighter, confirma ahí)' : `Transferir ${amount} ${asset}`}
                  </button>
                </form>
              </div>
            )}

            {view === 'receive' && (
              <div className="wallet-drawer-body text-center">
                <button type="button" className="btn-wallet-back" onClick={() => setView('overview')}>
                  ← Volver al saldo
                </button>
                <h3 className="wallet-form-title">Recibir en Stellar Testnet</h3>
                <div className="qr-placeholder-card">
                  <div className="qr-icon-large">
                    {publicKey ? <QrCode value={publicKey} label="QR de tu dirección Stellar" /> : '📱'}
                  </div>
                  <span className="qr-title">Código QR de tu Billetera</span>
                  <p className="wallet-key-full">{publicKey}</p>
                  <button type="button" className="btn-copy-key primary" onClick={handleCopy}>
                    {copied ? '¡Dirección Copiada!' : 'Copiar Dirección Stellar'}
                  </button>
                </div>
              </div>
            )}
          </>
      </aside>
    ) : (
    <div className="wallet-drawer-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <aside className="wallet-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="wallet-drawer-header">
          <div className="wallet-header-title-row">
            <span className="wallet-title">Billetera Kosmovia</span>
            <span className="wallet-testnet-pill">Stellar Testnet</span>
          </div>
          <button type="button" className="wallet-close-btn" onClick={onClose} aria-label="Cerrar billetera">
            ✕
          </button>
        </header>

          <>
            {view === 'overview' && (
              <div className="wallet-drawer-body">
                <div className="wallet-balance-card">
                  <span className="wallet-balance-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    Saldo Disponible
                    {onRefresh ? (
                      <button
                        type="button"
                        className="kv-refresh-btn"
                        onClick={onRefresh}
                        disabled={isRefreshing}
                        aria-label="Actualizar saldo"
                        title="Actualizar saldo"
                      >
                        <span aria-hidden="true" className={isRefreshing ? 'kv-spin' : undefined} style={{ display: 'inline-flex' }}>
                          <IconRefresh size={16} />
                        </span>
                      </button>
                    ) : null}
                  </span>
                  <div className="wallet-balance-value">
                    {balanceUSDC.toFixed(2)} <span className="wallet-asset-tag">USDC</span>
                  </div>
                  <div className="wallet-balance-sub">
                    {balanceXLM.toFixed(2)} XLM para comisiones de red
                  </div>
                  <div className="wallet-key-bar">
                    <span className="wallet-key-text">
                      {publicKey.slice(0, 8)}...{publicKey.slice(-6)}
                    </span>
                    <button type="button" className="btn-copy-key" onClick={handleCopy}>
                      {copied ? 'Copiado!' : 'Copiar'}
                    </button>
                  </div>
                </div>

                <div className="wallet-quick-actions">
                  <button
                    type="button"
                    className="btn-wallet-action primary"
                    onClick={() => setView('send')}
                  >
                    ↗ Enviar pago
                  </button>
                  <button
                    type="button"
                    className="btn-wallet-action secondary"
                    onClick={() => setView('receive')}
                  >
                    ↙ Recibir
                  </button>
                </div>

                <div className="wallet-tx-section">
                  <h3 className="wallet-tx-title">Actividad Reciente</h3>
                  <div className="wallet-tx-list">
                    {transactions.length === 0 ? (
                      <p className="wallet-empty-text">No hay transferencias aún.</p>
                    ) : (
                      transactions.map((tx) => (
                        <div key={tx.id} className="wallet-tx-item">
                          <div className={`wallet-tx-icon ${tx.type}`}>
                            {tx.type === 'sent' ? '↗' : '↙'}
                          </div>
                          <div className="wallet-tx-info">
                            <span className="wallet-tx-user">
                              {tx.counterparty}
                              {tx.type === 'sent' && tx.unverified ? (
                                <span
                                  className="kv-unverified"
                                  tabIndex={0}
                                  title="Este pago no pasó por tu PIN. Si no lo hiciste tú, cambia tu PIN y avísanos."
                                  aria-label="Sin PIN. Este pago no pasó por tu PIN. Si no lo hiciste tú, cambia tu PIN y avísanos."
                                >
                                  ⚠ Sin PIN
                                </span>
                              ) : null}
                            </span>
                            <span className="wallet-tx-time">{tx.timestamp}</span>
                          </div>
                          <div className="wallet-tx-amount-col">
                            <span className={`wallet-tx-amount ${tx.type}`}>
                              {tx.type === 'sent' ? '-' : '+'}
                              {tx.amount} {tx.asset}
                            </span>
                            <a
                              href={`https://stellar.expert/explorer/testnet/tx/${tx.hash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="wallet-explorer-link"
                            >
                              Explorer ↗
                            </a>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {view === 'send' && (
              <div className="wallet-drawer-body">
                <button type="button" className="btn-wallet-back" onClick={() => setView('overview')}>
                  ← Volver al saldo
                </button>
                <h3 className="wallet-form-title">Enviar Activo en Stellar</h3>
                <form onSubmit={handleSendSubmit} className="wallet-form">
                  <div className="form-group">
                    <label className="form-label">Destinatario (@usuario o Address)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      placeholder="@usuario o G..."
                      required
                    />
                    <RecipientPreview value={recipient} selfWallet={publicKey} />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Monto</label>
                    <div className="amount-input-row">
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="form-input"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        required
                      />
                      <select
                        className="form-select"
                        value={asset}
                        onChange={(e) => setAsset(e.target.value as 'USDC' | 'XLM')}
                      >
                        <option value="USDC">USDC</option>
                        <option value="XLM">XLM</option>
                      </select>
                    </div>
                  </div>

                  <div className="wallet-fee-hint">
                    <span>Comisión de red:</span>
                    <span className="free-tag">≈ 0.00001 XLM</span>
                  </div>

                  <button
                    type="submit"
                    className="btn-login-submit"
                    disabled={isSending}
                  >
                    {isSending ? 'Enviando… (si usas Freighter, confirma ahí)' : `Transferir ${amount} ${asset}`}
                  </button>
                </form>
              </div>
            )}

            {view === 'receive' && (
              <div className="wallet-drawer-body text-center">
                <button type="button" className="btn-wallet-back" onClick={() => setView('overview')}>
                  ← Volver al saldo
                </button>
                <h3 className="wallet-form-title">Recibir en Stellar Testnet</h3>
                <div className="qr-placeholder-card">
                  <div className="qr-icon-large">
                    {publicKey ? <QrCode value={publicKey} label="QR de tu dirección Stellar" /> : '📱'}
                  </div>
                  <span className="qr-title">Código QR de tu Billetera</span>
                  <p className="wallet-key-full">{publicKey}</p>
                  <button type="button" className="btn-copy-key primary" onClick={handleCopy}>
                    {copied ? '¡Dirección Copiada!' : 'Copiar Dirección Stellar'}
                  </button>
                </div>
              </div>
            )}
          </>
      </aside>
    </div>
    )
  );
}
