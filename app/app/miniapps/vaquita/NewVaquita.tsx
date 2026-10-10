'use client';

import { useMemo, useState } from 'react';
import { vaquitaService, type Vaquita } from '@/services';
import s from './vaquita.module.css';
import { parseAmount, toYmd } from './util';

export default function NewVaquita({
  slug,
  onBack,
  onCreated,
}: {
  slug: string;
  onBack: () => void;
  onCreated: (v: Vaquita) => void;
}) {
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [date, setDate] = useState('');
  const [desc, setDesc] = useState('');
  const [showDesc, setShowDesc] = useState(false);
  const [touched, setTouched] = useState({ title: false, goal: false, date: false });
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const { minDate, maxDate } = useMemo(() => {
    const now = new Date();
    const min = new Date(now);
    min.setDate(min.getDate() + 1);
    const max = new Date(now);
    max.setDate(max.getDate() + 364);
    return { minDate: toYmd(min), maxDate: toYmd(max) };
  }, []);

  const errors = {
    title: title.trim().length === 0 ? 'Escribe para qué es la vaquita.' : title.trim().length > 60 ? 'Máximo 60 letras.' : '',
    goal: (() => {
      const n = parseAmount(goal);
      if (goal.trim() === '') return 'Indica cuánto quieren juntar.';
      if (n === null) return 'Escribe solo números, por ejemplo 50 o 12.5.';
      if (n < 0.01) return 'La meta mínima es 0.01 USDC.';
      if (n > 100000) return 'La meta máxima es 100000 USDC.';
      return '';
    })(),
    date: date && (date < minDate || date > maxDate) ? 'Elige una fecha desde mañana y dentro del próximo año.' : '',
  };
  const valid = !errors.title && !errors.goal && !errors.date;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ title: true, goal: true, date: true });
    if (!valid || busy) return;
    setBusy(true);
    setServerError(null);
    try {
      const [y, m, d] = date ? date.split('-').map(Number) : [0, 0, 0];
      const v = await vaquitaService.create(slug, {
        title: title.trim(),
        goalUsdc: parseAmount(goal) as number,
        ...(desc.trim() ? { description: desc.trim() } : {}),
        ...(date ? { deadline: new Date(y, m - 1, d, 23, 59, 0).toISOString() } : {}),
      });
      onCreated(v);
    } catch (err) {
      setServerError(err instanceof Error && err.message ? err.message : 'No pudimos crear la vaquita. Intenta de nuevo.');
      setBusy(false);
    }
  }

  const show = (k: 'title' | 'goal' | 'date') => touched[k] && errors[k];

  return (
    <div className={s.wrap}>
      <header className={s.header}>
        <button type="button" className={s.iconBtn} onClick={onBack} aria-label="Volver">
          ←
        </button>
        <h1 className={s.pageTitle}>Nueva vaquita</h1>
      </header>

      <form className={s.form} onSubmit={submit} noValidate>
        <div className={s.field}>
          <label className={s.label} htmlFor="vq-title">
            ¿Para qué es?
          </label>
          <input
            id="vq-title"
            className={`${s.input} ${show('title') ? s.inputError : ''}`}
            value={title}
            maxLength={60}
            placeholder="Ej. Asado del sábado"
            autoComplete="off"
            aria-invalid={!!show('title')}
            aria-describedby={show('title') ? 'vq-title-err' : undefined}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, title: true }))}
          />
          {show('title') && (
            <span id="vq-title-err" className={s.errorText} role="alert">
              {errors.title}
            </span>
          )}
        </div>

        <div className={s.field}>
          <label className={s.label} htmlFor="vq-goal">
            Meta
          </label>
          <div className={s.moneyWrap}>
            <input
              id="vq-goal"
              className={`${s.input} ${show('goal') ? s.inputError : ''}`}
              value={goal}
              inputMode="decimal"
              placeholder="50"
              autoComplete="off"
              aria-invalid={!!show('goal')}
              aria-describedby={show('goal') ? 'vq-goal-err' : 'vq-goal-hint'}
              onChange={(e) => setGoal(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, goal: true }))}
            />
            <span className={s.moneyUnit} aria-hidden="true">
              USDC
            </span>
          </div>
          {show('goal') ? (
            <span id="vq-goal-err" className={s.errorText} role="alert">
              {errors.goal}
            </span>
          ) : (
            <span id="vq-goal-hint" className={s.hint}>
              USDC son dólares digitales.
            </span>
          )}
        </div>

        <div className={s.field}>
          <label className={s.label} htmlFor="vq-date">
            Fecha límite <span className={s.muted}>(opcional)</span>
          </label>
          <input
            id="vq-date"
            type="date"
            className={`${s.input} ${show('date') ? s.inputError : ''}`}
            value={date}
            min={minDate}
            max={maxDate}
            aria-invalid={!!show('date')}
            aria-describedby={show('date') ? 'vq-date-err' : undefined}
            onChange={(e) => setDate(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, date: true }))}
          />
          {show('date') && (
            <span id="vq-date-err" className={s.errorText} role="alert">
              {errors.date}
            </span>
          )}
        </div>

        {showDesc ? (
          <div className={s.field}>
            <label className={s.label} htmlFor="vq-desc">
              Detalle <span className={s.muted}>(opcional)</span>
            </label>
            <textarea
              id="vq-desc"
              className={s.input}
              value={desc}
              maxLength={280}
              placeholder="Cuenta un poco más para que todos entiendan."
              onChange={(e) => setDesc(e.target.value)}
            />
            <span className={s.hint}>{desc.length} de 280</span>
          </div>
        ) : (
          <div>
            <button type="button" className={s.linkBtn} onClick={() => setShowDesc(true)} aria-expanded={false}>
              + Agregar detalle
            </button>
          </div>
        )}

        {serverError && (
          <div className={`${s.notice} ${s.noticeErr}`} role="alert">
            {serverError}
          </div>
        )}

        <button type="submit" className={`${s.btn} ${s.btnPrimary} ${s.btnBlock}`} disabled={busy}>
          {busy ? 'Creando…' : 'Crear vaquita'}
        </button>
      </form>
    </div>
  );
}
