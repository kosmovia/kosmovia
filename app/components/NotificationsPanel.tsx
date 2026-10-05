'use client';

import React from 'react';
import { WalletTransaction } from '../types';
import { IconClose } from './Icons';

/**
 * Notificaciones de pagos en el panel derecho (como Miembros): queda abierto
 * mientras sigues chateando. Mismos estilos que la actividad de Mi Wallet.
 */
export function NotificationsPanel({ transactions, onClose }: { transactions: WalletTransaction[]; onClose: () => void }) {
  const recent = transactions.slice(0, 30);
  return (
    <aside className="member-sidebar kv-docked-panel" aria-label="Notificaciones de pagos">
      <div className="kv-panel-head">
        <span className="kv-panel-title">Notificaciones</span>
        <button type="button" className="wallet-close-btn" onClick={onClose} aria-label="Cerrar notificaciones">
          <IconClose size={18} />
        </button>
      </div>
      <div className="kv-panel-body">
      <div className="wallet-tx-list">
        {recent.length === 0 ? (
          <p className="wallet-empty-text">Todavía no hay pagos. Cuando envíes o recibas dinero, aparece aquí.</p>
        ) : (
          recent.map((tx) => (
            <div key={tx.id} className="wallet-tx-item">
              <div className={`wallet-tx-icon ${tx.type}`}>{tx.type === 'sent' ? '↗' : '↙'}</div>
              <div className="wallet-tx-info">
                <span className="wallet-tx-user">
                  {tx.type === 'sent' ? `Enviaste a ${tx.counterparty}` : `Recibiste de ${tx.counterparty}`}
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
                  Ver en la red ↗
                </a>
              </div>
            </div>
          ))
        )}
      </div>
      </div>
    </aside>
  );
}
