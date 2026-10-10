'use client';

import type { PptChoice } from '@/services';
import type { User } from '@/types';
import s from './retos.module.css';
import { initial } from './util';

export function Avatar({ user, size = 44 }: { user: Pick<User, 'displayName' | 'username' | 'avatar'>; size?: number }) {
  return (
    <span className={s.avatar} style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
      {user.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatar} alt="" />
      ) : (
        initial(user)
      )}
    </span>
  );
}

export function BackHeader({ title, onBack, right }: { title: string; onBack: () => void; right?: React.ReactNode }) {
  return (
    <header className={s.header}>
      <button type="button" className={s.iconBtn} onClick={onBack} aria-label="Volver">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 5 L8 12 L15 19" />
        </svg>
      </button>
      <h1 className={s.pageTitle}>{title}</h1>
      {right}
    </header>
  );
}

export function ErrorBox({ message, onRetry, retryLabel = 'Reintentar' }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div className={`${s.notice} ${s.noticeErr}`} role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function SkeletonBlock({ h, w }: { h: number; w?: string }) {
  return <div className={s.skel} style={{ height: h, width: w ?? '100%' }} aria-hidden="true" />;
}

export function SkeletonScreen({ label = 'Cargando Retos…' }: { label?: string }) {
  return (
    <div className={s.wrap} role="status" aria-live="polite">
      <span className={s.srOnly}>{label}</span>
      <SkeletonBlock h={40} w="150px" />
      <SkeletonBlock h={56} />
      <SkeletonBlock h={84} />
      <SkeletonBlock h={84} />
      <SkeletonBlock h={84} />
    </div>
  );
}

/** X (amarilla) y O (coral): distintas en forma, no solo en color. */
export function Mark({ kind, animate = true }: { kind: 'X' | 'O'; animate?: boolean }) {
  return (
    <svg viewBox="0 0 40 40" className={`${s.mark} ${animate ? s.markIn : ''}`} aria-hidden="true" focusable="false">
      {kind === 'X' ? (
        <path d="M9 9 L31 31 M31 9 L9 31" className={s.markX} pathLength={1} />
      ) : (
        <circle cx="20" cy="20" r="12.5" className={s.markO} pathLength={1} />
      )}
    </svg>
  );
}

const HAND_PATHS: Record<PptChoice, React.ReactNode> = {
  piedra: (
    <>
      <path d="M9 31c-1-9 4-17 13-18 8-1 15 4 16 12 1 7-4 11-12 11-8 0-16-1-17-5z" />
      <path d="M17 21c3-2 6-2 9 0" />
    </>
  ),
  papel: (
    <>
      <path d="M12 8h17l7 7v25H12z" />
      <path d="M29 8v7h7" />
      <path d="M17 24h14M17 30h14" />
    </>
  ),
  tijera: (
    <>
      <circle cx="14" cy="34" r="5.5" />
      <circle cx="34" cy="34" r="5.5" />
      <path d="M17 29 L33 6 M31 29 L15 6" />
    </>
  ),
};

export function HandIcon({ choice, size = 56 }: { choice: PptChoice; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {HAND_PATHS[choice]}
    </svg>
  );
}
