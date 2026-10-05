'use client';

import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Channel, Community, Message, User } from '../types';
import { AvatarFace } from './AvatarFace';
import { ComposerPlus } from './ComposerPlus';
import { EmojiPicker } from './EmojiPicker';
import { IconBell, IconLock, IconPencil, IconTrash, IconUsers, IconWallet } from './Icons';
import { WalletTransaction } from '../types';

interface ChatAreaProps {
  channel: Channel;
  /** 'dm': conversación directa (`channel.name` es el nombre de la otra persona). */
  variant?: 'channel' | 'dm';
  dmPeer?: User;
  community: Community;
  messages: Message[];
  onSendMessage: (content: string) => void;
  onToggleMobileMenu: () => void;
  onToggleMemberList?: () => void;
  isMemberListOpen?: boolean;
  onOpenWallet?: () => void;
  balanceUSDC?: number;
  onOpenQuickInvoice?: () => void;
  /** Paga el cobro a quien lo emitió (`payee` = @usuario del autor). true si el pago salió. */
  onPayInvoice?: (amount: number, concept: string, payee: string) => Promise<boolean> | void;
  isWalletOpen?: boolean;
  currentUserId?: string;
  /** Abre la tarjeta de perfil de quien escribió (avatar o nombre). */
  onOpenProfile?: (user: User) => void;
  /** Botón de solo ícono para actualizar el saldo. */
  onRefreshWallet?: () => void;
  isRefreshingWallet?: boolean;
  /** Campana de pagos enviados y recibidos. */
  notifications?: { transactions: WalletTransaction[]; unread: number; onOpen: () => void };
  /** La campana abre/cierra las notificaciones en el panel derecho. */
  onToggleNotifications?: () => void;
  isNotificationsOpen?: boolean;
  /** false en #anuncios (o similar) para quien no es dueño/admin: el campo se desactiva. */
  canPost?: boolean;
  /** Dueño, admin o moderador: puede borrar mensajes de otras personas. */
  canModerate?: boolean;
  /** Dueño o admin: el tema del canal es un botón que abre "Configurar canal". */
  onOpenChannelSettings?: () => void;
  /** Guarda la edición; true si se guardó. */
  onEditMessage?: (messageId: string, content: string) => Promise<boolean>;
  /** Borra el mensaje; true si se borró. */
  onDeleteMessage?: (messageId: string) => Promise<boolean>;
}

const COMPOSER_MAX_PX = 168; // ~8 líneas
const MAX_LEN = 2000;

/** Textarea que crece con el texto hasta un máximo y luego hace scroll. */
function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_PX)}px`;
    el.style.overflowY = el.scrollHeight > COMPOSER_MAX_PX ? 'auto' : 'hidden';
  }, [ref, value]);
}

export function ChatArea({
  channel,
  variant = 'channel',
  dmPeer,
  community,
  messages,
  onSendMessage,
  onToggleMobileMenu,
  onToggleMemberList,
  isMemberListOpen,
  onOpenWallet,
  balanceUSDC,
  onOpenQuickInvoice,
  onPayInvoice,
  isWalletOpen,
  currentUserId,
  onOpenProfile,
  onRefreshWallet,
  isRefreshingWallet,
  notifications,
  onToggleNotifications,
  isNotificationsOpen,
  canPost = true,
  canModerate = false,
  onOpenChannelSettings,
  onEditMessage,
  onDeleteMessage,
}: ChatAreaProps) {
  const [inputText, setInputText] = useState('');
  const [paidInvoices, setPaidInvoices] = useState<Record<string, boolean>>({});
  const [payingInvoice, setPayingInvoice] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const lastMessageId = useRef<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const isDm = variant === 'dm';
  const isPayments = !isDm && channel.type === 'payments';
  const label = isDm ? channel.name : `#${channel.name}`;

  useAutoGrow(composerRef, inputText);
  useAutoGrow(editRef, editText);

  // Solo baja al final cuando llega un mensaje nuevo (no en cada refresco por ediciones o borrados).
  const newestId = messages.length > 0 ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (newestId !== lastMessageId.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: lastMessageId.current === null ? 'auto' : 'smooth' });
      lastMessageId.current = newestId;
    }
  }, [newestId]);

  // Al cambiar de canal se cancelan edición y confirmación, y el siguiente canal baja al final sin animación.
  useEffect(() => {
    setEditingId(null);
    setConfirmDeleteId(null);
    lastMessageId.current = null;
  }, [channel.id]);

  const send = () => {
    const trimmed = inputText.trim();
    if (!trimmed || !canPost) return;
    onSendMessage(trimmed);
    setInputText('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send();
  };

  // Enter envía; Shift+Enter agrega una línea (no se envía mientras se compone con IME).
  const handleComposerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const startEdit = (msg: Message) => {
    setConfirmDeleteId(null);
    setEditingId(msg.id);
    setEditText(msg.content);
    setTimeout(() => editRef.current?.focus(), 0);
  };

  const saveEdit = async (msg: Message) => {
    const next = editText.trim();
    if (actionBusy) return;
    if (!next || next === msg.content) {
      setEditingId(null);
      return;
    }
    setActionBusy(true);
    const ok = await (onEditMessage?.(msg.id, next) ?? Promise.resolve(false));
    setActionBusy(false);
    if (ok) setEditingId(null);
  };

  const handleEditKey = (e: React.KeyboardEvent<HTMLTextAreaElement>, msg: Message) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setEditingId(null);
    } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void saveEdit(msg);
    }
  };

  const confirmDelete = async (msg: Message) => {
    if (actionBusy) return;
    setActionBusy(true);
    const ok = await (onDeleteMessage?.(msg.id) ?? Promise.resolve(false));
    setActionBusy(false);
    if (ok) setConfirmDeleteId(null);
  };

  // Se marca pagado solo si el pago salió de verdad.
  const handlePay = async (msgId: string, amount: number, concept: string, payee: string) => {
    if (paidInvoices[msgId] || payingInvoice || !onPayInvoice) return;
    setPayingInvoice(msgId);
    const ok = await onPayInvoice(amount, concept, payee);
    setPayingInvoice(null);
    if (ok !== false) setPaidInvoices((prev) => ({ ...prev, [msgId]: true }));
  };

  return (
    <main className="chat-area">
      <header className="chat-header">
        <div className="chat-header-info">
          <button
            type="button"
            className="menu-toggle-btn"
            onClick={onToggleMobileMenu}
            aria-label="Abrir menú de canales"
          >
            ☰
          </button>
          <div className="chat-header-title">
            {isDm ? (
              dmPeer ? (
                <span className="kv-dm-header-avatar">
                  <AvatarFace avatar={dmPeer.avatar} name={dmPeer.displayName} />
                </span>
              ) : null
            ) : channel.emoji ? (
              <span aria-hidden="true">{channel.emoji}</span>
            ) : (
              <span className="channel-hash">#</span>
            )}
            <span>{channel.name}</span>
          </div>
          {isDm ? (
            dmPeer ? <span className="chat-header-topic">{dmPeer.username}</span> : null
          ) : onOpenChannelSettings ? (
            <button
              type="button"
              className={`chat-header-topic kv-topic-btn ${channel.topic ? '' : 'empty'}`}
              onClick={onOpenChannelSettings}
              title={channel.topic ? `${channel.topic} (clic para editar)` : 'Agregar descripción del canal'}
            >
              {channel.topic || 'Agregar descripción'}
            </button>
          ) : (
            channel.topic && (
              <span className="chat-header-topic" title={channel.topic}>
                {channel.topic}
              </span>
            )
          )}
        </div>
        <div className="chat-header-actions">
          {notifications && onToggleNotifications && (
            <button
              type="button"
              className={`header-icon-btn ${isNotificationsOpen ? 'active' : ''}`}
              onClick={onToggleNotifications}
              aria-pressed={isNotificationsOpen}
              aria-label={notifications.unread > 0 ? `Notificaciones: ${notifications.unread} nuevas` : 'Notificaciones'}
              title="Notificaciones de pagos"
              style={{ position: 'relative' }}
            >
              <IconBell />
              {notifications.unread > 0 ? (
                <span className="tab-pending-badge" style={{ position: 'absolute', top: -6, right: -6 }}>
                  {notifications.unread > 9 ? '9+' : notifications.unread}
                </span>
              ) : null}
            </button>
          )}
          {onOpenWallet && (
            <button
              type="button"
              className={`header-icon-btn ${isWalletOpen ? 'active' : ''}`}
              onClick={onOpenWallet}
              aria-pressed={isWalletOpen}
              aria-label={balanceUSDC !== undefined ? `Mi Wallet: ${balanceUSDC.toFixed(2)} USDC` : 'Mi Wallet'}
              title={balanceUSDC !== undefined ? `Mi Wallet · ${balanceUSDC.toFixed(2)} USDC` : 'Mi Wallet'}
            >
              <IconWallet />
            </button>
          )}
          {onToggleMemberList && (
            <button
              type="button"
              className={`header-icon-btn ${isMemberListOpen ? 'active' : ''}`}
              onClick={onToggleMemberList}
              aria-label={isMemberListOpen ? 'Ocultar miembros' : 'Mostrar miembros'}
              aria-pressed={isMemberListOpen}
              title="Miembros"
            >
              <IconUsers />
            </button>
          )}
        </div>
      </header>

      <section className="message-feed" aria-label="Historial de mensajes">
        {messages.length === 0 ? (
          <div className="empty-chat-state">
            <div className="empty-chat-icon">{isPayments ? '💸' : channel.emoji || '💬'}</div>
            <h3 className="empty-chat-title">{isDm ? `Tu conversación con ${channel.name}` : isPayments ? 'Comprobantes de pago' : `Bienvenido a #${channel.name}`}</h3>
            <p className="empty-chat-desc">
              {isDm
                ? 'Este es el inicio de la conversación. Escribe el primer mensaje.'
                : isPayments
                  ? 'Aquí aparecerán los comprobantes de los pagos verificados en Stellar.'
                  : channel.topic || 'Este es el inicio del canal. ¡Sé el primero en enviar un mensaje o emitir un cobro B2B en Stellar!'}
            </p>
            <div className="empty-chat-actions">
              {canPost && !isDm && (
                <button
                  type="button"
                  className="btn-empty-action"
                  onClick={() => onSendMessage('👋 ¡Hola a todos! Arrancamos la conversación por acá.')}
                >
                  👋 Saludar en el canal
                </button>
              )}
              {onOpenQuickInvoice && canPost && (
                <button
                  type="button"
                  className="btn-empty-action accent"
                  onClick={onOpenQuickInvoice}
                >
                  💸 Emitir Cobro B2B
                </button>
              )}
            </div>
          </div>
        ) : (
          messages.map((msg, index) => {
            // Detectar si el mensaje es una tarjeta de cobro B2B interactiva
            const isInvoice = msg.content.startsWith('[COBRO_B2B:');
            let invoiceData: { amount: number; concept: string } | null = null;
            if (isInvoice) {
              try {
                // El JSON va entre '[COBRO_B2B:' y el último ']' (el concepto puede tener corchetes).
                const raw = msg.content.slice('[COBRO_B2B:'.length, msg.content.lastIndexOf(']'));
                const parsed = JSON.parse(raw);
                invoiceData =
                  typeof parsed?.amount === 'number' && parsed.amount > 0 && typeof parsed?.concept === 'string'
                    ? { amount: parsed.amount, concept: parsed.concept }
                    : null;
              } catch {
                invoiceData = null;
              }
            }

            const prev = index > 0 ? messages[index - 1] : null;
            const grouped =
              !invoiceData && prev !== null && prev.author.id === msg.author.id && !prev.content.startsWith('[COBRO_B2B:');
            const isPaid = paidInvoices[msg.id];
            const isMine = currentUserId !== undefined && msg.author.id === currentUserId;
            const isPaying = payingInvoice === msg.id;

            const canEdit = isMine && !invoiceData && !!onEditMessage;
            const canDelete = (isMine || canModerate) && !!onDeleteMessage;
            const isEditing = editingId === msg.id;
            const isConfirming = confirmDeleteId === msg.id;

            return (
              <article key={msg.id} className={`message-item ${grouped ? 'kv-grouped' : ''} ${isEditing ? 'kv-editing' : ''}`}>
                {grouped ? (
                  <div className="kv-avatar-spacer" aria-hidden="true">
                    <time className="kv-grouped-time">{msg.createdAt}</time>
                  </div>
                ) : (
                <div className="msg-avatar">
                  <button
                    type="button"
                    onClick={() => onOpenProfile?.(msg.author)}
                    aria-label={`Ver perfil de ${msg.author.username}`}
                    style={{ ...{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontFamily: 'inherit' }, width: '100%', height: '100%', borderRadius: 'inherit', color: 'inherit' }}
                  >
                    <AvatarFace avatar={msg.author.avatar} name={msg.author.displayName} />
                  </button>
                </div>
                )}
                <div className="msg-body">
                  {grouped ? null : (
                  <div className="msg-header">
                    <button
                      type="button"
                      className="msg-author"
                      onClick={() => onOpenProfile?.(msg.author)}
                      title={`Ver perfil de ${msg.author.username}`}
                      style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      {msg.author.displayName}
                    </button>
                    {msg.author.role === 'admin' && <span className="msg-role-tag admin">admin</span>}
                    <time className="msg-time">{msg.createdAt}</time>
                  </div>
                  )}

                  {invoiceData ? (
                    <div className="invoice-card">
                      <div className="invoice-header-row">
                        <span className="invoice-tag">Cobro en Stellar</span>
                        <span className="invoice-amount-text">{invoiceData.amount} USDC</span>
                      </div>
                      <p className="invoice-concept">{invoiceData.concept}</p>
                      <button
                        type="button"
                        className={`btn-pay-invoice ${isPaid ? 'paid' : ''}`}
                        onClick={() => invoiceData && void handlePay(msg.id, invoiceData.amount, invoiceData.concept, msg.author.username)}
                        disabled={isPaid || isMine || isPaying || payingInvoice !== null}
                        title={isMine ? 'Es tu propio cobro' : undefined}
                      >
                        {isPaid
                          ? '✓ Pago Confirmado en Testnet'
                          : isMine
                            ? 'Tu cobro: esperando pago'
                            : isPaying
                              ? 'Pagando…'
                              : `Pagar ${invoiceData.amount} USDC a ${msg.author.username}`}
                      </button>
                    </div>
                  ) : isEditing ? (
                    <div className="kv-edit-box">
                      <textarea
                        ref={editRef}
                        className="kv-edit-field"
                        rows={1}
                        maxLength={MAX_LEN}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => handleEditKey(e, msg)}
                        aria-label="Editar mensaje"
                        disabled={actionBusy}
                      />
                      <div className="kv-edit-hint">
                        Enter guarda · Shift+Enter nueva línea · Esc cancela
                        <span className="kv-edit-buttons">
                          <button type="button" className="kv-mini-btn" onClick={() => setEditingId(null)} disabled={actionBusy}>
                            Cancelar
                          </button>
                          <button
                            type="button"
                            className="kv-mini-btn primary"
                            onClick={() => void saveEdit(msg)}
                            disabled={actionBusy || !editText.trim()}
                          >
                            {actionBusy ? 'Guardando…' : 'Guardar'}
                          </button>
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="msg-content">
                      {msg.content}
                      {msg.editedAt ? (
                        <span className="kv-edited" title="Este mensaje fue editado">
                          {' '}(editado)
                        </span>
                      ) : null}
                    </p>
                  )}
                  {isConfirming ? (
                    <div className="kv-confirm-row" role="alertdialog" aria-label="Confirmar borrado">
                      <span>¿Borrar este mensaje?</span>
                      <button type="button" className="kv-mini-btn" onClick={() => setConfirmDeleteId(null)} disabled={actionBusy}>
                        No
                      </button>
                      <button type="button" className="kv-mini-btn danger" onClick={() => void confirmDelete(msg)} disabled={actionBusy} autoFocus>
                        {actionBusy ? 'Borrando…' : 'Sí, borrar'}
                      </button>
                    </div>
                  ) : null}
                </div>
                {!isEditing && !isConfirming && (canEdit || canDelete) ? (
                  <div className="kv-msg-actions" role="group" aria-label="Acciones del mensaje">
                    {canEdit ? (
                      <button type="button" className="kv-msg-action" onClick={() => startEdit(msg)} aria-label="Editar mensaje" title="Editar">
                        <IconPencil size={15} />
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button
                        type="button"
                        className="kv-msg-action danger"
                        onClick={() => {
                          setEditingId(null);
                          setConfirmDeleteId(msg.id);
                        }}
                        aria-label="Borrar mensaje"
                        title="Borrar"
                      >
                        <IconTrash size={15} />
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </section>

      <footer className="chat-input-container">
        {isPayments ? (
          <div className="chat-input-box kv-composer-locked" role="note">
            <IconLock size={16} />
            <span>Aquí se publican los comprobantes de pago verificados</span>
          </div>
        ) : canPost ? (
          <form onSubmit={handleSubmit} className="chat-input-box">
            {isDm ? null : <ComposerPlus onInvoice={onOpenQuickInvoice} />}
            <textarea
              ref={composerRef}
              className="chat-input-field"
              rows={1}
              maxLength={MAX_LEN}
              placeholder={isDm ? `Mensaje para ${label}` : `Mensaje en ${label}`}
              aria-label={isDm ? `Mensaje para ${label}` : `Mensaje en ${label}`}
              aria-keyshortcuts="Enter"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleComposerKey}
            />
            <EmojiPicker onPick={(emoji) => setInputText((t) => t + emoji)} />
            <button type="submit" className="chat-send-btn" disabled={!inputText.trim()}>
              Enviar
            </button>
          </form>
        ) : (
          <div className="chat-input-box kv-composer-locked" role="note">
            <IconLock size={16} />
            <span>Solo los admins pueden escribir en #{channel.name}</span>
          </div>
        )}
      </footer>
    </main>
  );
}
