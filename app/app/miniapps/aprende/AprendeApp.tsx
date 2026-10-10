'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { kosmovia, MiniAppError, type MiniAppContext, type MiniAppUser } from '@/lib/miniapp-sdk/client';
import Home from './Home';
import Lesson from './Lesson';
import Missions from './Missions';
import Ranking from './Ranking';
import { ErrorState, Header, Loading, Logo } from './ui';
import { learningFont } from './font';
import s from './aprende.module.css';

type Boot = 'loading' | 'outside' | 'welcome' | 'app' | 'error';
type Screen = { name: 'home' | 'missions' | 'ranking' } | { name: 'lesson'; id: string };
export default function AprendeApp() {
  const [boot, setBoot] = useState<Boot>('loading');
  const [context, setContext] = useState<MiniAppContext | null>(null);
  const [user, setUser] = useState<MiniAppUser | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const started = useRef(false);
  const connectLock = useRef(false);
  const root = useRef<HTMLElement>(null);
  const enter = useCallback((ctx: MiniAppContext, person: MiniAppUser) => {
    setUser(person); setScreen(ctx.params.lessonId ? { name: 'lesson', id: ctx.params.lessonId } : { name: 'home' }); setBoot('app');
  }, []);
  const start = useCallback(async () => {
    setBoot('loading'); setError(null);
    if (!kosmovia.isInKosmovia()) { setBoot('outside'); return; }
    try {
      const ctx = await kosmovia.ready(); setContext(ctx);
      try { enter(ctx, await kosmovia.getUser()); }
      catch (e) { if (e instanceof MiniAppError && e.code === 'not_connected') setBoot('welcome'); else throw e; }
    } catch { setError('Kosmovia no respondió. Intenta abrir tu espacio otra vez.'); setBoot('error'); }
  }, [enter]);
  useEffect(() => { if (!started.current) { started.current = true; void start(); } }, [start]);
  const key = screen.name === 'lesson' ? screen.id : screen.name;
  useEffect(() => { root.current?.scrollTo({ top: 0 }); root.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }); }, [key, boot]);
  async function connect() {
    if (!context || connectLock.current) return;
    connectLock.current = true; setConnecting(true); setError(null);
    try { enter(context, (await kosmovia.connect()).user); }
    catch (e) { setError(e instanceof MiniAppError && e.code === 'user_rejected' ? 'Puedes conectar cuando quieras. Tu espacio seguirá aquí.' : 'No pudimos conectar. Vuelve a intentarlo.'); }
    finally { connectLock.current = false; setConnecting(false); }
  }
  const back = () => setScreen({ name: 'home' });
  return <main ref={root} className={`${s.root} ${learningFont.className}`} lang="es"><div className={s.wrap}>
    {boot === 'loading' && <Loading />}
    {(boot === 'welcome' || boot === 'outside') && <div className={s.hero}><p className={s.eyebrow}>TU ESPACIO PARA APRENDER</p><div className={s.logoHalo}><Logo size={128} /></div><h1 tabIndex={-1} className={s.welcomeTitle}>Aprende<br /><span>Stellar</span></h1>
      {boot === 'outside' ? <><p className={s.intro}>Abre Aprende Stellar desde Kosmovia</p><a className={s.primary} href="/plataforma" target="_top">Ir a Kosmovia</a></> : <><p className={s.intro}>Aprende cómo funciona el dinero en Stellar con lecciones de 2 minutos y gana insignias.</p><button className={s.primary} disabled={connecting} onClick={() => void connect()}>{connecting ? 'Conectando…' : 'Conectar con Kosmovia'}</button>{error && <p className={s.error} role="alert">{error}</p>}<p className={s.small}>Un paso a la vez. A tu ritmo.</p></>}
    </div>}
    {boot === 'error' && <><Logo size={76} /><h1 tabIndex={-1}>No pudimos abrir tu espacio</h1><ErrorState message={error ?? 'Intenta de nuevo.'} retry={() => void start()} /></>}
    {boot === 'app' && user && (screen.name === 'lesson' ? <Lesson key={screen.id} id={screen.id} back={back} /> : screen.name === 'missions' ? <><Header title="Misiones" back={back} /><Missions /></> : screen.name === 'ranking' ? <Ranking slug={context?.community?.slug ?? null} userId={user.id} back={back} /> : <Home open={id => setScreen({ name: 'lesson', id })} missions={() => setScreen({ name: 'missions' })} ranking={() => setScreen({ name: 'ranking' })} />)}
  </div></main>;
}
