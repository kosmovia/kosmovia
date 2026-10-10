'use client';

import { useEffect, useRef, useState } from 'react';
import { academiaService, type AnswersResult, type LessonDetail } from '@/services';
import { ErrorState, Header, Loading, Logo, Progress, errorMessage } from './ui';
import s from './aprende.module.css';

export default function Lesson({ id, back }: { id: string; back: () => void }) {
  const [data, setData] = useState<LessonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [stage, setStage] = useState<'read' | 'practice' | 'quiz' | 'result'>('read');
  const [paragraph, setParagraph] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [choice, setChoice] = useState<number | null>(null);
  const [result, setResult] = useState<AnswersResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current = true; alive.current = true; setError(null);
    void academiaService.getLesson(id).then(value => { if (current) setData(value); }).catch(e => { if (current) setError(errorMessage(e)); });
    return () => { current = false; alive.current = false; };
  }, [id, attempt]);
  useEffect(() => {
    const main = content.current?.closest('main');
    main?.scrollTo({ top: 0 });
    content.current?.focus({ preventScroll: true });
  }, [stage, paragraph, answers.length]);

  async function advance() {
    if (!data || choice === null || lock.current) return;
    const next = [...answers, choice];
    if (next.length < data.questions.length) { setAnswers(next); setChoice(null); return; }
    lock.current = true; setBusy(true); setSubmitError(null);
    try {
      // La corrección y las recompensas pertenecen al servicio, nunca a la UI.
      const response = await academiaService.submitAnswers(data.id, next);
      if (alive.current) { setResult(response); setStage('result'); }
    } catch (e) { if (alive.current) setSubmitError(errorMessage(e)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  function restart() { setAnswers([]); setChoice(null); setResult(null); setSubmitError(null); setStage('quiz'); }
  const question = data?.questions[answers.length];
  return <>
    <Header title={stage === 'result' ? 'Tu resultado' : data?.title ?? 'Lección'} back={back} />
    {error ? <ErrorState message={error} retry={() => setAttempt(n => n + 1)} /> : !data ? <Loading /> : <div ref={content} tabIndex={-1} className={s.stack}>
      {stage === 'read' && <>
        <p className={s.eyebrow}>LECTURA · {paragraph + 1} DE {data.paragraphs.length}</p>
        <Progress value={(paragraph + 1) / data.paragraphs.length * 100} label="Avance de lectura" />
        <article className={`${s.card} ${s.readCard}`}><span className={s.orbit} aria-hidden="true">✦</span><p>{data.paragraphs[paragraph]}</p></article>
        <button className={s.primary} onClick={() => paragraph + 1 < data.paragraphs.length ? setParagraph(n => n + 1) : setStage('practice')}>Siguiente <span aria-hidden="true">→</span></button>
        {paragraph > 0 && <button className={s.link} onClick={() => setParagraph(n => n - 1)}>Párrafo anterior</button>}
      </>}
      {stage === 'practice' && <div className={s.hero}><Logo size={100} /><h2 className={s.heroTitle}>¡A practicar!</h2><p className={s.muted}>Cuatro preguntas para poner a prueba lo que aprendiste. Necesitas 3 de 4 para completar la lección.</p><button className={s.primary} onClick={restart}>Comenzar preguntas</button><button className={s.link} onClick={() => { setParagraph(0); setStage('read'); }}>Leer otra vez</button></div>}
      {stage === 'quiz' && question && <>
        <p className={s.eyebrow}>Pregunta {answers.length + 1} de {data.questions.length}</p>
        <Progress value={(answers.length + 1) / data.questions.length * 100} label="Avance de preguntas" />
        <h2 className={s.question}>{question.text}</h2>
        <div className={s.stack} role="group" aria-label="Elige una respuesta">{question.options.map((option, index) => <button key={index} aria-pressed={choice === index} className={`${s.option} ${choice === index ? s.selected : ''}`} disabled={busy} onClick={() => { setChoice(index); setSubmitError(null); }}><span className={s.optionLetter} aria-hidden="true">{String.fromCharCode(65 + index)}</span><span>{option}</span>{choice === index && <span aria-hidden="true">✓</span>}</button>)}</div>
        {submitError && <p className={s.error} role="alert">{submitError} Tus respuestas siguen aquí. Puedes volver a enviarlas.</p>}
        <button className={s.primary} disabled={choice === null || busy} onClick={() => void advance()}>{busy ? 'Revisando respuestas…' : submitError ? 'Reintentar envío' : answers.length + 1 === data.questions.length ? 'Ver mi resultado' : 'Siguiente pregunta'}</button>
      </>}
      {stage === 'result' && result && <>
        <section className={`${s.card} ${s.result}`} aria-label="Resultado"><Logo size={76} /><strong className={s.score}>{result.score}<span>/{result.total}</span></strong><h2>{result.passed ? '¡Lección completada!' : 'Cada intento te acerca'}</h2><p className={s.muted}>{result.passed ? 'Un paso más para conocer Stellar.' : 'Necesitas 3 de 4. Revisa las respuestas y vuelve a intentarlo.'}</p>{result.xpEarned > 0 && <p className={s.reward}>+{result.xpEarned} XP</p>}</section>
        {result.newBadges.length > 0 && <div className={s.celebration} role="status">★ ¡Nueva insignia!<ul className={s.list}>{result.newBadges.map(b => <li key={b}>{result.summary.badges.find(item => item.id === b)?.name ?? 'Insignia ganada'}</li>)}</ul></div>}
        <button className={s.primary} onClick={back}>Volver a lecciones</button>
        <button className={s.secondary} onClick={restart}>Volver a intentar</button>
        <h2>Aprende de tus respuestas</h2>
        <ol className={s.list}>{result.corrections.map(c => <li key={c.question} className={s.card}><p className={c.isCorrect ? s.success : s.correction}>Pregunta {c.question + 1} · {c.isCorrect ? 'Correcta' : 'Para repasar'}</p><h3>{data.questions[c.question]?.text}</h3><p className={s.muted}>Tu respuesta: <span className={s.strong}>{data.questions[c.question]?.options[c.chosen]}</span></p><p className={s.muted}>Respuesta correcta: <span className={s.strong}>{data.questions[c.question]?.options[c.correct]}</span></p><p>{c.explanation}</p></li>)}</ol>
      </>}
    </div>}
  </>;
}
