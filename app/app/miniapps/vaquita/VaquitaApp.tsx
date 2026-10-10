'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { kosmovia, MiniAppError, type MiniAppContext, type MiniAppUser } from '@/lib/miniapp-sdk/client';
import s from './vaquita.module.css';
import { nunito } from './font';
import Logo from './Logo';
import Home from './Home';
import NewVaquita from './NewVaquita';
import Detail from './Detail';
import { SkeletonScreen } from './ui';

type Boot = 'loading' | 'outside' | 'error' | 'welcome' | 'app';
type Screen = { name: 'home' } | { name: 'new' } | { name: 'detail'; id: string };

export default function VaquitaApp() {
  const [boot, setBoot] = useState<Boot>('loading');
  const [ctx, setCtx] = useState<MiniAppContext | null>(null);
  const [user, setUser] = useState<MiniAppUser | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [connecting, setConnecting] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const started = useRef(false);
  const rootRef = useRef<HTMLElement>(null);

  const screenKey = screen.name === 'detail' ? `d-${screen.id}` : screen.name;
  useEffect(() => {
    rootRef.current?.scrollTo({ top: 0 });
  }, [screenKey, boot]);

  const enter = useCallback((c: MiniAppContext, u: MiniAppUser) => {
    setUser(u);
    const id = c.params?.vaquitaId;
    setScreen(id ? { name: 'detail', id } : { name: 'home' });
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
  let body: React.ReactNode;

  if (boot === 'loading') {
    body = <SkeletonScreen />;
  } else if (boot === 'outside') {
    body = (
      <div className={s.wrap}>
        <div className={s.hero}>
          <div className={s.heroBadge}>
            <Logo size={104} />
          </div>
          <h1 className={s.heroTitle}>Vaquita</h1>
          <p className={s.heroText}>Abre Vaquita desde Kosmovia</p>
          <p className={s.heroNote}>Vaquita funciona dentro de las comunidades de Kosmovia, junto a tu chat y tu wallet.</p>
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
          <Logo size={84} />
          <div className={s.centerTitle}>No pudimos abrir Vaquita</div>
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
            <Logo size={104} />
          </div>
          <h1 className={s.heroTitle}>Vaquita</h1>
          <p className={s.heroText}>Junten dinero para algo en común, fácil y transparente.</p>
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
          <p className={s.heroNote}>Kosmovia te pedirá tu PIN. Vaquita nunca lo ve.</p>
          <p className={s.heroNote}>Se usa USDC, dólares digitales.</p>
        </div>
      </div>
    );
  } else if (!user || !slug) {
    body = (
      <div className={s.wrap}>
        <div className={s.center}>
          <Logo size={84} />
          <div className={s.centerTitle}>Abre Vaquita en una comunidad</div>
          <p className={s.muted}>Las vaquitas pertenecen a una comunidad. Entra a una y abre Vaquita desde ahí.</p>
        </div>
      </div>
    );
  } else if (screen.name === 'new') {
    body = (
      <NewVaquita
        slug={slug}
        onBack={() => setScreen({ name: 'home' })}
        onCreated={(v) => setScreen({ name: 'detail', id: v.id })}
      />
    );
  } else if (screen.name === 'detail') {
    body = <Detail key={screen.id} id={screen.id} user={user} onBack={() => setScreen({ name: 'home' })} />;
  } else {
    body = (
      <Home
        slug={slug}
        user={user}
        onOpen={(id) => setScreen({ name: 'detail', id })}
        onNew={() => setScreen({ name: 'new' })}
      />
    );
  }

  return (
    <main ref={rootRef} className={`${s.root} ${nunito.className}`} lang="es">
      {body}
    </main>
  );
}
