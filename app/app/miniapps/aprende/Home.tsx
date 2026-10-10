'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { academiaService, type AcademiaSummary, type LessonList } from '@/services';
import { ErrorState, Loading, Logo, Summary, errorMessage } from './ui';
import Missions from './Missions';
import s from './aprende.module.css';

export default function Home({ open, ranking, missions }: { open: (id: string) => void; ranking: () => void; missions: () => void }) {
  const [data, setData] = useState<LessonList | null>(null);
  const [summary, setSummary] = useState<AcademiaSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const missionSummary = useRef<AcademiaSummary | null>(null);
  const updateSummary = useCallback((value: AcademiaSummary) => { missionSummary.current = value; setSummary(value); }, []);
  useEffect(() => {
    let alive = true;
    setError(null);
    void academiaService.lessons().then(value => {
      if (alive) { setData(value); setSummary(missionSummary.current ?? value.summary); }
    }).catch(e => { if (alive) setError(errorMessage(e)); });
    return () => { alive = false; };
  }, [attempt]);
  return <>
    <header className={s.header}><Logo size={38} /><h1 tabIndex={-1} className={s.brand}>Aprende Stellar</h1><span className={s.orbit} aria-hidden="true">✦</span></header>
    <div><p className={s.eyebrow}>UN POCO CADA DÍA</p><h2 className={s.heroTitle}>Tu siguiente<br />gran descubrimiento.</h2><p className={s.muted}>Dos minutos para entender un poco más.</p></div>
    {summary && <Summary data={summary} />}
    <section className={s.stack} aria-labelledby="lessons-title"><div className={s.row}><h2 id="lessons-title">Lecciones</h2><span className={s.small}>A tu ritmo</span></div>
      {error ? <ErrorState message={error} retry={() => setAttempt(n => n + 1)} /> : !data ? <Loading /> : data.lessons.length === 0 ? <div className={s.card}><p>Las lecciones están en camino. Vuelve pronto.</p><button className={s.link} onClick={() => setAttempt(n => n + 1)}>Actualizar lecciones</button></div> :
        <ol className={s.list}>{data.lessons.map((lesson, i) => <li key={lesson.id}><button className={`${s.card} ${s.lessonCard}`} onClick={() => open(lesson.id)}>
          <span className={lesson.completed ? s.numberDone : s.number} aria-hidden="true">{lesson.completed ? '✓' : String(i + 1).padStart(2, '0')}</span>
          <span className={s.stack}><strong>{lesson.title}</strong><span className={s.muted}>{lesson.summary}</span><span className={s.small}>2 min · {lesson.bestScore === null ? 'Sin intentar' : `Mejor nota: ${lesson.bestScore}/${lesson.questionCount}`}{lesson.completed ? ' · Completada' : ''}</span></span>
          <span aria-hidden="true" className={s.arrow}>↗</span>
        </button></li>)}</ol>}
    </section>
    <section className={s.stack} aria-labelledby="missions-title"><div className={s.row}><h2 id="missions-title">Misiones</h2><span className={s.small}>De la idea a la acción</span></div><Missions compact onSummary={updateSummary} /><button className={s.secondary} onClick={missions}>Ver misiones</button></section>
    <button className={s.link} onClick={ranking}>Tabla de la comunidad <span aria-hidden="true">→</span></button>
    <p className={`${s.small} ${s.footer}`}>Cada paso cuenta. Sigue explorando.</p>
  </>;
}
