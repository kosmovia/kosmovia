'use client';

import type { Vaquita } from '@/services';
import type { User } from '@/types';
import s from './vaquita.module.css';
import { deadlineText, fmtUsdc, initial, isActive, percent } from './util';

export function Avatar({ user }: { user: Pick<User, 'displayName' | 'username' | 'avatar'> }) {
  const name = user.displayName || user.username;
  return (
    <span className={s.avatar} aria-hidden="true">
      {user.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatar} alt="" />
      ) : (
        initial(name)
      )}
    </span>
  );
}

export function ProgressBar({ v, big = false }: { v: Vaquita; big?: boolean }) {
  const pct = percent(v);
  const done = v.raisedUsdc >= v.goalUsdc;
  return (
    <div
      className={`${s.bar} ${big ? s.barBig : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={`Avance: ${pct}% de la meta`}
    >
      <div
        className={`${s.barFill} ${done ? s.barFillDone : ''} ${pct === 0 ? s.barEmpty : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function StatusChip({ v }: { v: Vaquita }) {
  const active = isActive(v);
  const done = v.raisedUsdc >= v.goalUsdc;
  if (!active) return <span className={`${s.chip} ${s.chipOff}`}>{deadlineText(v)}</span>;
  if (done) return <span className={`${s.chip} ${s.chipDone}`}>¡Meta lograda!</span>;
  return <span className={s.chip}>{deadlineText(v)}</span>;
}

export function VaquitaCard({ v, onOpen }: { v: Vaquita; onOpen: () => void }) {
  return (
    <button type="button" className={s.card} onClick={onOpen}>
      <div className={s.cardTitle}>{v.title}</div>
      <ProgressBar v={v} />
      <div className={s.cardRow}>
        <span>
          <span className={s.strong}>{fmtUsdc(v.raisedUsdc)}</span> de {fmtUsdc(v.goalUsdc)} USDC
        </span>
        <StatusChip v={v} />
      </div>
      <div className={s.cardMeta}>
        <span>
          {v.contributorsCount === 0
            ? 'Sin aportes todavía'
            : v.contributorsCount === 1
              ? '1 aportante'
              : `${v.contributorsCount} aportantes`}
        </span>
        <span>De {v.creator.displayName}</span>
      </div>
    </button>
  );
}

export function SkeletonBlock({ h, w }: { h: number; w?: string }) {
  return <div className={s.skel} style={{ height: h, width: w ?? '100%' }} aria-hidden="true" />;
}

/** Esqueleto propio mientras Kosmovia responde y mientras cargan los datos. */
export function SkeletonScreen() {
  return (
    <div className={s.wrap} role="status" aria-live="polite">
      <span className={s.srOnly}>Cargando Vaquita…</span>
      <div className={s.header}>
        <SkeletonBlock h={32} w="140px" />
      </div>
      <SkeletonBlock h={22} w="60%" />
      <SkeletonBlock h={118} />
      <SkeletonBlock h={118} />
      <SkeletonBlock h={118} />
    </div>
  );
}
