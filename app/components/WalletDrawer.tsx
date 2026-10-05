'use client';

import React, { useEffect, useState } from 'react';
import { SettlementRecord, WalletTransaction } from '../types';
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
  settlements?: SettlementRecord[];
  onDisbursePending?: () => void;
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
  settlements = [],
  onDisbursePending,
  sendTo,
  onRefresh,
  isRefreshing,
  docked = false,
}: WalletDrawerProps) {
  const [activeTab, setActiveTab] = useState<'wallet' | 'settlements'>('wallet');
  const [view, setView] = useState<'overview' | 'send' | 'receive'>('overview');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('0.01');
  const [asset, setAsset] = useState<'USDC' | 'XLM'>('USDC');
  const [copied, setCopied] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isDisbursing, setIsDisbursing] = useState(false);
  const [disbursedNotice, setDisbursedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!sendTo) return;
    setActiveTab('wallet');
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

  // Cálculo de métricas de liquidaciones B2B
  const totalInvoiced = settlements.reduce((acc, curr) => acc + curr.totalUSDC, 0);
  const totalFees = settlements.reduce((acc, curr) => acc + curr.feeUSDC, 0);
  const totalNet = settlements.reduce((acc, curr) => acc + curr.netUSDC, 0);
  const pendingCount = settlements.filter((s) => s.status === 'PENDING').length;

  // Exportar reporte contable a CSV
  const handleExportCSV = () => {
    const headers = ['ID_Orden,Fecha,Cliente,Concepto,Total_USDC,Fee_0_5_USDC,Neto_USDC,Estado,Stellar_TxHash'];
    const rows = settlements.map((s) =>
      `"${s.orderId}","${s.createdAt}","${s.client}","${s.concept.replace(/"/g, '""')}",${s.totalUSDC.toFixed(2)},${s.feeUSDC.toFixed(2)},${s.netUSDC.toFixed(2)},"${s.status}","${s.settlementTxHash}"`
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `kosmovia_liquidaciones_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDisburse = () => {
    setIsDisbursing(true);
    setTimeout(() => {
      setIsDisbursing(false);
      setDisbursedNotice('¡Lote liquidado y dispersado exitosamente a tu billetera Stellar!');
      if (onDisbursePending) {
        onDisbursePending();
      }
      setTimeout(() => setDisbursedNotice(null), 4000);
    }, 900);
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

        {/* Barra de pestañas Billetera vs Liquidaciones B2B */}
        <nav className="wallet-nav-tabs" aria-label="Navegación de Billetera">
          <button
            type="button"
            className={`wallet-nav-tab ${activeTab === 'wallet' ? 'active' : ''}`}
            onClick={() => setActiveTab('wallet')}
            aria-label="Saldo y envío"
            title="Saldo y envío"
          >
            <span aria-hidden="true">💳</span> Saldo
          </button>
          <button
            type="button"
            className={`wallet-nav-tab ${activeTab === 'settlements' ? 'active' : ''}`}
            onClick={() => setActiveTab('settlements')}
            aria-label={pendingCount > 0 ? `Liquidaciones B2B, ${pendingCount} pendientes` : 'Liquidaciones B2B'}
            title="Liquidaciones B2B"
          >
            <span aria-hidden="true">📊</span> Cobros B2B
            {pendingCount > 0 && <span className="tab-pending-badge">{pendingCount}</span>}
          </button>
        </nav>

        {activeTab === 'wallet' && (
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
                            <span className="wallet-tx-user">{tx.counterparty}</span>
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
        )}

        {activeTab === 'settlements' && (
          <div className="wallet-drawer-body">
            <div className="settlement-metrics-grid">
              <div className="settlement-stat-card">
                <span className="settlement-stat-label">Total Recaudado</span>
                <span className="settlement-stat-value">{totalInvoiced.toFixed(2)} USDC</span>
                <span className="settlement-stat-sub">Bruto cobrado</span>
              </div>
              <div className="settlement-stat-card">
                <span className="settlement-stat-label">Fee Pasarela (0.5%)</span>
                <span className="settlement-stat-value fee">{totalFees.toFixed(2)} USDC</span>
                <span className="settlement-stat-sub">Retención mínima</span>
              </div>
              <div className="settlement-stat-card full-width">
                <span className="settlement-stat-label">Neto Liquidado</span>
                <span className="settlement-stat-value highlight">{totalNet.toFixed(2)} USDC</span>
                <span className="settlement-stat-sub">Disponible para dispersión en Bolivia</span>
              </div>
            </div>

            {disbursedNotice && (
              <div className="settlement-notice-box">
                {disbursedNotice}
              </div>
            )}

            <div className="settlement-actions-row">
              <button
                type="button"
                className="btn-export-csv"
                onClick={handleExportCSV}
                disabled={settlements.length === 0}
                title="Descargar archivo CSV compatible con contabilidad"
              >
                📥 Exportar CSV
              </button>
              {pendingCount > 0 && (
                <button
                  type="button"
                  className="btn-disburse-batch"
                  onClick={handleDisburse}
                  disabled={isDisbursing}
                >
                  {isDisbursing ? 'Liquidando...' : `⚡ Liquidar Lote (${pendingCount})`}
                </button>
              )}
            </div>

            <div className="wallet-tx-section">
              <div className="settlement-section-header">
                <h3 className="wallet-tx-title">Historial de Cobros B2B</h3>
                <span className="settlement-count-badge">{settlements.length} órdenes</span>
              </div>

              <div className="settlement-list">
                {settlements.length === 0 ? (
                  <p className="wallet-empty-text">No hay órdenes facturadas todavía. Emite una desde el chat con 💸.</p>
                ) : (
                  settlements.map((s) => (
                    <div key={s.id} className="settlement-item">
                      <div className="settlement-header-row">
                        <span className="settlement-order-id">{s.orderId}</span>
                        <span className={`settlement-status-badge ${s.status.toLowerCase()}`}>
                          {s.status === 'COMPLETED' ? '✓ Liquidado' : '⏳ Pendiente'}
                        </span>
                      </div>
                      <p className="settlement-concept">{s.concept}</p>
                      <div className="settlement-meta-row">
                        <span className="settlement-client">Cliente: {s.client}</span>
                        <span className="settlement-time">{s.createdAt}</span>
                      </div>
                      <div className="settlement-amounts-row">
                        <div className="amount-col">
                          <span className="amount-col-label">Total</span>
                          <span className="amount-col-val">{s.totalUSDC.toFixed(2)}</span>
                        </div>
                        <div className="amount-col">
                          <span className="amount-col-label">Fee 0.5%</span>
                          <span className="amount-col-val fee">-{s.feeUSDC.toFixed(2)}</span>
                        </div>
                        <div className="amount-col">
                          <span className="amount-col-label">Neto</span>
                          <span className="amount-col-val net">+{s.netUSDC.toFixed(2)} USDC</span>
                        </div>
                      </div>
                      <div className="settlement-footer-row">
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${s.settlementTxHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="wallet-explorer-link"
                        >
                          Auditoría en StellarExpert ↗
                        </a>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
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

        {/* Barra de pestañas Billetera vs Liquidaciones B2B */}
        <nav className="wallet-nav-tabs" aria-label="Navegación de Billetera">
          <button
            type="button"
            className={`wallet-nav-tab ${activeTab === 'wallet' ? 'active' : ''}`}
            onClick={() => setActiveTab('wallet')}
          >
            💳 Saldo & Envío
          </button>
          <button
            type="button"
            className={`wallet-nav-tab ${activeTab === 'settlements' ? 'active' : ''}`}
            onClick={() => setActiveTab('settlements')}
          >
            📊 Liquidaciones B2B
            {pendingCount > 0 && <span className="tab-pending-badge">{pendingCount}</span>}
          </button>
        </nav>

        {activeTab === 'wallet' && (
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
                            <span className="wallet-tx-user">{tx.counterparty}</span>
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
        )}

        {activeTab === 'settlements' && (
          <div className="wallet-drawer-body">
            <div className="settlement-metrics-grid">
              <div className="settlement-stat-card">
                <span className="settlement-stat-label">Total Recaudado</span>
                <span className="settlement-stat-value">{totalInvoiced.toFixed(2)} USDC</span>
                <span className="settlement-stat-sub">Bruto cobrado</span>
              </div>
              <div className="settlement-stat-card">
                <span className="settlement-stat-label">Fee Pasarela (0.5%)</span>
                <span className="settlement-stat-value fee">{totalFees.toFixed(2)} USDC</span>
                <span className="settlement-stat-sub">Retención mínima</span>
              </div>
              <div className="settlement-stat-card full-width">
                <span className="settlement-stat-label">Neto Liquidado</span>
                <span className="settlement-stat-value highlight">{totalNet.toFixed(2)} USDC</span>
                <span className="settlement-stat-sub">Disponible para dispersión en Bolivia</span>
              </div>
            </div>

            {disbursedNotice && (
              <div className="settlement-notice-box">
                {disbursedNotice}
              </div>
            )}

            <div className="settlement-actions-row">
              <button
                type="button"
                className="btn-export-csv"
                onClick={handleExportCSV}
                disabled={settlements.length === 0}
                title="Descargar archivo CSV compatible con contabilidad"
              >
                📥 Exportar CSV
              </button>
              {pendingCount > 0 && (
                <button
                  type="button"
                  className="btn-disburse-batch"
                  onClick={handleDisburse}
                  disabled={isDisbursing}
                >
                  {isDisbursing ? 'Liquidando...' : `⚡ Liquidar Lote (${pendingCount})`}
                </button>
              )}
            </div>

            <div className="wallet-tx-section">
              <div className="settlement-section-header">
                <h3 className="wallet-tx-title">Historial de Cobros B2B</h3>
                <span className="settlement-count-badge">{settlements.length} órdenes</span>
              </div>

              <div className="settlement-list">
                {settlements.length === 0 ? (
                  <p className="wallet-empty-text">No hay órdenes facturadas todavía. Emite una desde el chat con 💸.</p>
                ) : (
                  settlements.map((s) => (
                    <div key={s.id} className="settlement-item">
                      <div className="settlement-header-row">
                        <span className="settlement-order-id">{s.orderId}</span>
                        <span className={`settlement-status-badge ${s.status.toLowerCase()}`}>
                          {s.status === 'COMPLETED' ? '✓ Liquidado' : '⏳ Pendiente'}
                        </span>
                      </div>
                      <p className="settlement-concept">{s.concept}</p>
                      <div className="settlement-meta-row">
                        <span className="settlement-client">Cliente: {s.client}</span>
                        <span className="settlement-time">{s.createdAt}</span>
                      </div>
                      <div className="settlement-amounts-row">
                        <div className="amount-col">
                          <span className="amount-col-label">Total</span>
                          <span className="amount-col-val">{s.totalUSDC.toFixed(2)}</span>
                        </div>
                        <div className="amount-col">
                          <span className="amount-col-label">Fee 0.5%</span>
                          <span className="amount-col-val fee">-{s.feeUSDC.toFixed(2)}</span>
                        </div>
                        <div className="amount-col">
                          <span className="amount-col-label">Neto</span>
                          <span className="amount-col-val net">+{s.netUSDC.toFixed(2)} USDC</span>
                        </div>
                      </div>
                      <div className="settlement-footer-row">
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${s.settlementTxHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="wallet-explorer-link"
                        >
                          Auditoría en StellarExpert ↗
                        </a>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
    )
  );
}
