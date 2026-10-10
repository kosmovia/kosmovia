'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { kosmovia, MiniAppError, type MiniAppContext, type MiniAppUser } from '@/lib/miniapp-sdk/client';
import type { RetoGame } from '@/services';
import s from './retos.module.css';
import { fredoka } from './font';
import Logo from './Logo';
import Home from './Home';
import NewReto from './NewReto';
import Game from './Game';
import Ranking from './Ranking';
import { SkeletonScreen } from './ui';

type Boot = 'loading' | 'outside' | 'error' | 'welcome' | 'app';
type Screen =
  | { name: 'home' }
  | { name: 'new'; game?: RetoGame; opponent?: string }
  | { name: 'game'; id: string }
  | { name: 'ranking' };

export default function RetosApp() {
  const [boot, setBoot] = useState<Boot>('loading');
  const [ctx, setCtx] = useState<MiniAppContext | null>(null);
  const [user, setUser] = useState<MiniAppUser | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [connecting, setConnecting] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const started = useRef(false);
  const rootRef = useRef<HTMLElement>(null);

  const screenKey = screen.name === 'game' ? `g-${screen.id}` : screen.name;
  useEffect(() => {
    rootRef.current?.scrollTo({ top: 0 });
  }, [screenKey, boot]);

  const enter = useCallback((c: MiniAppContext, u: MiniAppUser) => {
    setUser(u);
    const id = c.params?.retoId;
    setScreen(id ? { name: 'game', id } : { name: 'home' });
    setBoot('app');
  }, []);

  const start = useCallback(async () => {
    setBoot('loading');
    setBootError(null);
    if (!kosmovia.isInKosmovia()) {
      setBoot('outside');
      return;
    }
    try {
      const c = await kosmovia.ready();
      setCtx(c);
      try {
        enter(c, await kosmovia.getUser());
      } catch {
        setBoot('welcome');
      }
    } catch (e) {
      setBootError(e instanceof Error && e.message ? e.message : 'Kosmovia no respondió.');
      setBoot('error');
    }
  }, [enter]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  async function connect() {
    if (!ctx || connecting) return;
    setConnecting(true);
    setConnectMsg(null);
    try {
      const r = await kosmovia.connect();
      enter(ctx, r.user);
    } catch (e) {
      if (e instanceof MiniAppError && e.code === 'user_rejected') {
        setConnectMsg('Sin problema. Cuando quieras, toca el botón para conectar.');
      } else {
        setConnectMsg('No pudimos conectar con Kosmovia. Intenta de nuevo.');
      }
    }
    setConnecting(false);
  }

  const slug = ctx?.community?.slug ?? null;
  const goHome = () => setScreen({ name: 'home' });
  let body: React.ReactNode;

  if (boot === 'loading') {
    body = <SkeletonScreen />;
  } else if (boot === 'outside') {
    body = (
      <div className={s.wrap}>
        <div className={s.hero}>
          <div className={s.heroBadge}>
            <Logo size={96} />
          </div>
          <h1 className={s.heroTitle}>Retos</h1>
          <p className={s.heroText}>Abre Retos desde Kosmovia</p>
          <p className={s.heroNote}>Retos funciona dentro de las comunidades de Kosmovia, junto a tu chat y tus amigos.</p>
          <a className={`${s.btn} ${s.btnPrimary} ${s.btnBlock}`} style={{ maxWidth: 320 }} href="/plataforma">
            Ir a Kosmovia
          </a>
        </div>
      </div>
    );
  } else if (boot === 'error') {
    body = (
      <div className={s.wrap}>
        <div className={s.center}>
          <Logo size={72} />
          <div className={s.centerTitle}>No pudimos abrir Retos</div>
          <p className={s.muted}>{bootError}</p>
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => void start()}>
            Reintentar
          </button>
        </div>
      </div>
    );
  } else if (boot === 'welcome') {
    body = (
      <div className={s.wrap}>
        <div className={s.hero}>
          <div className={s.heroBadge}>
            <Logo size={96} />
          </div>
          <h1 className={s.heroTitle}>Retos</h1>
          <p className={s.heroText}>Desafía a tus amigos de la comunidad. Sin apuestas: solo por diversión y puntos.</p>
          <button
            type="button"
            className={`${s.btn} ${s.btnPrimary} ${s.btnBlock}`}
            style={{ maxWidth: 320 }}
            onClick={() => void connect()}
            disabled={connecting}
          >
            {connecting ? 'Conectando…' : 'Conectar con Kosmovia'}
          </button>
          {connectMsg && (
            <div className={s.softNote} role="status">
              {connectMsg}
            </div>
          )}
          <p className={s.heroNote}>Kosmovia te pedirá tu PIN. Retos nunca lo ve.</p>
        </div>
      </div>
    );
  } else if (!user || !slug) {
    body = (
      <div className={s.wrap}>
        <div className={s.center}>
          <Logo size={72} />
          <div className={s.centerTitle}>Abre Retos en una comunidad</div>
          <p className={s.muted}>Los retos son entre miembros de una comunidad. Entra a una y abre Retos desde ahí.</p>
        </div>
      </div>
    );
  } else if (screen.name === 'new') {
    body = (
      <NewReto
        slug={slug}
        user={user}
        initialGame={screen.game}
        initialOpponent={screen.opponent}
        onBack={goHome}
        onOpen={(id) => setScreen({ name: 'game', id })}
      />
    );
  } else if (screen.name === 'game') {
    body = (
      <Game
        key={screen.id}
        id={screen.id}
        slug={slug}
        onBack={goHome}
        onRanking={() => setScreen({ name: 'ranking' })}
        onOpen={(id) => setScreen({ name: 'game', id })}
      />
    );
  } else if (screen.name === 'ranking') {
    body = <Ranking slug={slug} user={user} onBack={goHome} />;
  } else {
    body = (
      <Home
        slug={slug}
        user={user}
        onOpen={(id) => setScreen({ name: 'game', id })}
        onNew={() => setScreen({ name: 'new' })}
        onRanking={() => setScreen({ name: 'ranking' })}
      />
    );
  }

  return (
    <main ref={rootRef} className={`${s.root} ${fredoka.className}`} lang="es">
      {body}
    </main>
  );
}
