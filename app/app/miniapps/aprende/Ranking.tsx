'use client';

import { useEffect, useState } from 'react';
import { academiaService, type AcademiaRankingEntry } from '@/services';
import { Avatar, ErrorState, Header, Loading, badgeNames, errorMessage } from './ui';
import s from './aprende.module.css';

export default function Ranking({ slug, userId, back }: { slug: string | null; userId: string; back: () => void }) {
  const [rows, setRows] = useState<AcademiaRankingEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!slug) return;
    let alive = true; setError(null);
    void academiaService.ranking(slug).then(data => { if (alive) setRows(data); }).catch(e => { if (alive) setError(errorMessage(e)); });
    return () => { alive = false; };
  }, [slug, attempt]);
  return <><Header title="Tabla de la comunidad" back={back} /><p className={s.muted}>Aprender juntos nos lleva más lejos. Aquí aparecen quienes ya ganaron XP.</p>
    {!slug ? <div className={s.card}>Abre Aprende Stellar en una comunidad para ver su tabla.</div> : error ? <ErrorState message={error} retry={() => setAttempt(n => n + 1)} /> : !rows ? <Loading /> : rows.length === 0 ? <div className={s.card}><h2>El primer paso puede ser tuyo</h2><p className={s.muted}>Todavía no hay XP en esta comunidad. Completa una lección para comenzar.</p><button className={s.primary} onClick={back}>Ir a lecciones</button><button className={s.link} onClick={() => setAttempt(n => n + 1)}>Actualizar tabla</button></div> :
      <table className={s.table}><caption className={s.srOnly}>Posiciones por XP de la comunidad</caption><thead><tr><th scope="col">N.º</th><th scope="col">Persona</th><th scope="col">XP</th></tr></thead><tbody>{rows.map(row => <tr key={row.user.id} className={row.user.id === userId ? s.currentUser : ''}><td>{row.rank}</td><td><div className={s.person}><Avatar name={row.user.displayName || row.user.username} src={row.user.avatar} /><div className={s.personText}><strong>{row.user.displayName || row.user.username}{row.user.id === userId && <span className={s.you}> · Tú</span>}</strong><span className={s.small}>{row.badges.length} {row.badges.length === 1 ? 'insignia' : 'insignias'}</span><span className={s.small}>{row.badges.map(id => badgeNames[id] ?? 'Insignia').join(' · ')}</span></div></div></td><td className={s.rankingXp}>{row.xp}</td></tr>)}</tbody></table>}
  </>;
}
