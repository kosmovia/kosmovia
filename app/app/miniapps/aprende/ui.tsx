'use client';

import { useState } from 'react';
import { AcademiaError, type AcademiaSummary } from '@/services';
import s from './aprende.module.css';

export const badgeNames: Record<string, string> = {
  'primeros-pasos': 'Primeros pasos', 'conoce-stellar': 'Conoce Stellar', 'manos-a-la-obra': 'Manos a la obra',
};
export function errorMessage(error: unknown) {
  return error instanceof AcademiaError ? error.message : 'No pudimos cargar esto. Intenta de nuevo en un momento.';
}
export function Logo({ size = 48 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <circle cx="50" cy="50" r="47" fill="#233252" />
    <path d="m50 27 10 20 22 3-16 16 4 23-20-11-20 11 4-23-16-16 22-3Z" fill="#F6D365" stroke="#101A33" strokeWidth="3" strokeLinejoin="round" />
    <path d="M35 29v12q15 12 30 0V29" fill="#B9C8EA" stroke="#101A33" strokeWidth="3" />
    <path d="m50 13 29 13-29 13-29-13Z" fill="#F5F7FF" stroke="#101A33" strokeWidth="3" strokeLinejoin="round" />
    <path d="M78 27v18" stroke="#F6D365" strokeWidth="3" strokeLinecap="round" />
    <circle cx="78" cy="47" r="3" fill="#F6D365" />
  </svg>;
}
export function Loading() {
  return <div className={s.stack} role="status"><p className={s.muted}>Preparando tu espacio…</p><div className={s.skeleton} /><div className={s.skeleton} /></div>;
}
export function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return <div className={s.error} role="alert"><p>{message}</p><button className={s.secondary} onClick={retry}>Reintentar</button></div>;
}
export function Header({ title, back }: { title: string; back: () => void }) {
  return <header className={s.header}><button className={s.back} aria-label="Volver a lecciones" onClick={back}>←</button><h1 tabIndex={-1} className={s.title}>{title}</h1></header>;
}
export function Avatar({ name, src }: { name: string; src?: string | null }) {
  const [broken, setBroken] = useState(false);
  return <span className={s.avatar} aria-hidden="true">{src && !broken ?
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" onError={() => setBroken(true)} /> : (name.replace(/^@/, '')[0] || '?').toUpperCase()}</span>;
}
export function Progress({ value, label }: { value: number; label: string }) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  return <div className={s.track} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>;
}
export function Summary({ data }: { data: AcademiaSummary }) {
  // Insignias por hitos, no por umbrales arbitrarios de XP.
  const next = !data.badges.some(b => b.id === 'primeros-pasos' && b.earned)
    ? { name: 'Primeros pasos', current: data.lessonsCompleted, target: 1, unit: 'lecciones' }
    : !data.badges.some(b => b.id === 'conoce-stellar' && b.earned)
      ? { name: 'Conoce Stellar', current: data.lessonsCompleted, target: 5, unit: 'lecciones' }
      : !data.badges.some(b => b.id === 'manos-a-la-obra' && b.earned)
        ? { name: 'Manos a la obra', current: data.missionsCompleted, target: 3, unit: 'misiones' } : null;
  return <section className={`${s.card} ${s.summary}`} aria-label="Tu progreso">
    <div className={s.row}><div><p className={s.eyebrow}>TU RECORRIDO</p><strong className={s.xp}>{data.xp} <small>XP</small></strong></div><Logo size={60} /></div>
    <p className={s.muted}>{data.lessonsCompleted}/5 lecciones · {data.missionsCompleted}/3 misiones</p>
    <ul className={s.badges} aria-label="Tus insignias">{data.badges.map(b => <li key={b.id} className={b.earned ? s.earned : s.badge} title={b.description}><span aria-hidden="true">{b.earned ? '★' : '☆'}</span> {b.name}<span className={s.srOnly}>{b.earned ? ': ganada' : ': pendiente'}</span></li>)}</ul>
    <p className={s.small}>{next ? <>Próxima: <b>{next.name}</b> · {next.current}/{next.target} {next.unit}</> : '¡Ganaste todas las insignias!'}</p>
    <Progress value={next ? next.current / next.target * 100 : 100} label={next ? `Avance hacia ${next.name}` : 'Todas las insignias ganadas'} />
  </section>;
}
