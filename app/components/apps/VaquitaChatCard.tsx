'use client';

import React, { useEffect, useState } from 'react';
import { vaquitaService } from '../../services';
import type { Vaquita } from '../../services';
import { deadlineLabel, fmtUsdc, percent } from './VaquitaApp';

/** Tarjeta compacta de una vaquita compartida en el chat (`[VAQUITA:id]`). */
export function VaquitaChatCard({ id, onOpen }: { id: string; onOpen?: (id: string) => void }) {
  const [v, setV] = useState<Vaquita | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    vaquitaService
      .get(id)
      .then((d) => alive && setV(d.vaquita))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <div className="invoice-card kv-vq-chatcard">
      <div className="invoice-header-row">
        <span className="invoice-tag">🐄 Vaquita</span>
        {v ? <span className="invoice-amount-text">{percent(v)}%</span> : null}
      </div>
      {v ? (
        <>
          <p className="invoice-concept">{v.title}</p>
          <div className="kv-vq-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent(v)} aria-label="Progreso">
            <div className="kv-vq-bar-fill" style={{ width: `${percent(v)}%` }} />
          </div>
          <p className="kv-app-perms">
            {fmtUsdc(v.raisedUsdc)} / {fmtUsdc(v.goalUsdc)} USDC
            {v.status === 'closed' ? ' · Cerrada' : deadlineLabel(v) ? ` · ${deadlineLabel(v)}` : ''}
          </p>
        </>
      ) : (
        <p className="invoice-concept">{failed ? 'Esta vaquita no está disponible.' : 'Cargando…'}</p>
      )}
      <button type="button" className="btn-pay-invoice" onClick={() => onOpen?.(id)} disabled={!onOpen || failed}>
        Ver vaquita
      </button>
    </div>
  );
}
