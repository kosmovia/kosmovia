'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { academiaService, type AcademiaSummary, type MissionsResult } from '@/services';
import { badgeNames, ErrorState, Loading, errorMessage } from './ui';
import s from './aprende.module.css';

const instructions: Record<string, string> = {
  'crear-pin': 'Crea tu PIN en Configuración → Seguridad.',
  'primer-pago': 'Envía tu primer pago con PIN desde tu wallet.',
  'aportar-vaquita': 'Aporta a una vaquita en Aplicaciones → Vaquita.',
};
export default function Missions({ compact = false, onSummary }: { compact?: boolean; onSummary?: (data: AcademiaSummary) => void }) {
  const [data, setData] = useState<MissionsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [celebration, setCelebration] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const active = useRef(false);
  const locked = useRef(false);
  const load = useCallback(async (verify = false) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setError(null); setFeedback(null);
    try {
      const result = await academiaService.missions();
      if (!active.current) return;
      setData(result); onSummary?.(result.summary);
      const newBadges = result.summary.badges.filter(b => b.earned && b.id === 'manos-a-la-obra' && result.newlyCompleted.length > 0);
      if (result.newlyCompleted.length) {
        const xp = result.missions.filter(m => result.newlyCompleted.includes(m.id)).reduce((sum, m) => sum + m.xp, 0);
        setCelebration(`¡Misión cumplida! +${xp} XP${newBadges.length ? ` · Nueva insignia: ${badgeNames['manos-a-la-obra']}` : ''}`);
      } else if (verify) { setCelebration(null); setFeedback('Estado actualizado. Si acabas de completar una misión, espera un momento y verifica otra vez.'); }
    } catch (e) { if (active.current) setError(errorMessage(e)); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }, [onSummary]);
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; }; }, [load]);
  return <div className={s.stack}>
    {!compact && <p className={s.muted}>Haz estos pasos en Kosmovia y vuelve aquí para verificar tu avance. Cada misión da XP una sola vez.</p>}
    {celebration && <div className={s.celebration} role="status"><span aria-hidden="true">✦</span> {celebration}</div>}
    {feedback && <p className={s.small} role="status">{feedback}</p>}
    {error && <ErrorState message={error} retry={() => void load(true)} />}
    {!data && !error && <Loading />}
    {data?.missions.length === 0 && <div className={s.card}><p>Aún no hay misiones. Vuelve pronto.</p><button className={s.link} onClick={() => void load(true)} disabled={busy}>Actualizar misiones</button></div>}
    <ul className={s.list}>{data?.missions.map((mission, i) => <li className={s.card} key={mission.id}>
      <div className={s.row}><span className={s.eyebrow}>MISIÓN {i + 1}</span><span className={mission.completed ? s.success : s.small}>{mission.completed ? '✓ Completada' : `+${mission.xp} XP`}</span></div>
      <h3>{mission.title}</h3>
      {!compact && <p className={s.muted}>{instructions[mission.id] ?? mission.description}</p>}
      {compact && !mission.completed && <p className={s.small}>Pendiente</p>}
      {!compact && !mission.completed && <button className={s.secondary} disabled={busy} onClick={() => void load(true)}>{busy ? 'Verificando…' : 'Verificar'}<span className={s.srOnly}>: {mission.title}</span></button>}
    </li>)}</ul>
  </div>;
}
