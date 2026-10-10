'use client';

import React from 'react';
import { DmThread, WalletTransaction } from '../types';
import { previewText } from '../lib/core/attachments-rules.ts';
import { AvatarFace } from './AvatarFace';
import { IconClose } from './Icons';

/**
 * Mensajes directos y pagos en el panel derecho (como Miembros): queda abierto
 * mientras sigues chateando. Mismos estilos que la actividad de Mi Wallet.
 */
export function NotificationsPanel({ transactions, threads = [], onOpenThread, onClose }: {
  transactions: WalletTransaction[];
  threads?: DmThread[];
  onOpenThread?: (id: string) => void;
  onClose: () => void;
}) {
  const recent = transactions.slice(0, 30);
  const recentThreads = threads.slice().sort((a, b) =>
    (b.lastMessageAt ?? b.lastMessage?.createdAt ?? '').localeCompare(a.lastMessageAt ?? a.lastMessage?.createdAt ?? '')
  ).slice(0, 30);
  return (
    <aside className="member-sidebar kv-docked-panel" aria-label="Notificaciones de mensajes y pagos">
      <div className="kv-panel-head">
        <span className="kv-panel-title">Notificaciones</span>
        <button type="button" className="wallet-close-btn" onClick={onClose} aria-label="Cerrar notificaciones">
          <IconClose size={18} />
        </button>
      </div>
      <div className="kv-panel-body">
      <section aria-labelledby="kv-notifications-messages">
        <h3 id="kv-notifications-messages" className="kv-panel-title">Mensajes directos</h3>
        {recentThreads.length === 0 ? (
          <p className="wallet-empty-text">Todavía no hay conversaciones.</p>
        ) : recentThreads.map((thread) => (
          <button
            key={thread.id}
            type="button"
            className="kv-dm-item"
            onClick={() => onOpenThread?.(thread.id)}
            disabled={!onOpenThread}
            aria-label={`Abrir conversación con ${thread.other.displayName}${thread.unread > 0 ? `, ${thread.unread} mensajes sin leer` : ''}`}
          >
            <span className="kv-dm-avatar">
              <AvatarFace avatar={thread.other.avatar} name={thread.other.displayName} />
            </span>
            <span className="kv-dm-text">
              <span className={`kv-dm-name ${thread.unread > 0 ? 'unread' : ''}`}>{thread.other.displayName}</span>
              <span className="kv-dm-preview">
                {thread.lastMessage ? previewText(thread.lastMessage.content) : 'Sin mensajes todavía'}
              </span>
            </span>
            {thread.unread > 0 ? (
              <span className="kv-unread-badge" aria-label={`${thread.unread} sin leer`}>
                {thread.unread > 9 ? '9+' : thread.unread}
              </span>
            ) : null}
          </button>
        ))}
      </section>
      <section aria-labelledby="kv-notifications-payments">
      <h3 id="kv-notifications-payments" className="kv-panel-title">Pagos</h3>
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
      </section>
      </div>
    </aside>
  );
}
