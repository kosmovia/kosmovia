'use client';

import React, { useState } from 'react';

interface QuickInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (amount: number, concept: string) => void;
}

export function QuickInvoiceModal({
  isOpen,
  onClose,
  onSubmit,
}: QuickInvoiceModalProps) {
  const [amount, setAmount] = useState('');
  const [concept, setConcept] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseFloat(amount.replace(',', '.'));
    if (isNaN(num) || num < 0.01 || !concept.trim()) return;
    onSubmit(Math.round(num * 100) / 100, concept.trim().slice(0, 200));
    setAmount('');
    setConcept('');
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
