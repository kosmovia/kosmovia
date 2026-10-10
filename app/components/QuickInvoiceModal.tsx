'use client';

import React, { useState } from 'react';
import { User } from '../types';

interface QuickInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** `payerId` null = lo paga cualquier miembro del canal. */
  onSubmit: (amount: number, concept: string, payerId: string | null) => void;
  /** Para elegir destinatario. Sin lista, el cobro queda abierto a cualquiera. */
  members?: User[];
  /** No tiene sentido cobrarse a uno mismo: se excluye de la lista. */
  currentUserId?: string;
}

export function QuickInvoiceModal({
  isOpen,
  onClose,
  onSubmit,
  members,
  currentUserId,
}: QuickInvoiceModalProps) {
  const [amount, setAmount] = useState('');
  const [concept, setConcept] = useState('');
  const [payerId, setPayerId] = useState('');

  if (!isOpen) return null;

  const candidates = (members || []).filter((m) => m.id !== currentUserId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseFloat(amount.replace(',', '.'));
    if (isNaN(num) || num < 0.01 || !concept.trim()) return;
    onSubmit(Math.round(num * 100) / 100, concept.trim().slice(0, 200), payerId || null);
    setAmount('');
    setConcept('');
    setPayerId('');
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3 className="modal-title">Crear cobro</h3>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </header>

        <form onSubmit={handleSubmit} className="modal-body">
          <p className="settings-tab-desc">
            Crea una tarjeta de pago en Stellar (USDC) visible para los miembros de este canal.
          </p>

          <div className="form-group">
            <label className="form-label">Monto (USDC)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.01"
              className="form-input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">Concepto o Detalle de Factura</label>
            <input
              type="text"
              className="form-input"
              placeholder="ej: Factura #204 - Bienes Raíces / Concesionaria"
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              required
            />
          </div>

          {candidates.length > 0 ? (
            <div className="form-group">
              <label className="form-label" htmlFor="kv-invoice-payer">
                ¿Quién debe pagarlo?
              </label>
              <select
                id="kv-invoice-payer"
                className="form-input"
                value={payerId}
                onChange={(e) => setPayerId(e.target.value)}
              >
                <option value="">Cualquiera del canal</option>
                {candidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.username}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={!amount}
            >
              Publicar Cobro en Chat
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
