'use client';

import { useCallback, useEffect, useState } from 'react';
import { vaquitaService, type Vaquita } from '@/services';
import type { MiniAppUser } from '@/lib/miniapp-sdk/client';
import s from './vaquita.module.css';
import Logo from './Logo';
import { SkeletonBlock, VaquitaCard } from './ui';

export default function Home({
  slug,
  user,
  onOpen,
  onNew,
}: {
  slug: string;
  user: MiniAppUser;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const [items, setItems] = useState<Vaquita[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setItems(null);
    try {
      setItems(await vaquitaService.list(slug));
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'No pudimos cargar las vaquitas.');
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const first = (user.displayName || user.username).replace(/^@/, '').split(' ')[0];

  return (
    <div className={s.wrap}>
      <header className={s.header}>
        <div className={s.brand}>
          <Logo size={36} />
          <span>Vaquita</span>
        </div>
      </header>

      <h1 className={s.pageTitle} style={{ whiteSpace: 'normal', flex: 'none' }}>
        Hola, {first}
      </h1>

      <button type="button" className={`${s.btn} ${s.btnPrimary} ${s.btnBlock}`} onClick={onNew}>
        + Nueva vaquita
      </button>

      {error && (
        <div className={`${s.notice} ${s.noticeErr}`} role="alert">
          <span>{error}</span>
          <button type="button" className={`${s.btn} ${s.btnSecondary}`} onClick={() => void load()}>
            Reintentar
          </button>
        </div>
      )}

      {!error && items === null && (
        <div role="status" aria-live="polite">
          <span className={s.srOnly}>Cargando vaquitas…</span>
          <div className={s.list}>
            <SkeletonBlock h={124} />
            <SkeletonBlock h={124} />
          </div>
        </div>
      )}

      {items && items.length === 0 && (
        <div className={s.center}>
          <Logo size={96} />
          <div className={s.centerTitle}>Aún no hay vaquitas</div>
          <p className={s.muted}>
            Crea la primera para juntar USDC (dólares digitales) entre la comunidad: un asado, un regalo, lo que sea.
          </p>
        </div>
      )}

      {items && items.length > 0 && (
        <ul className={s.list} aria-label="Vaquitas de la comunidad">
          {items.map((v) => (
            <li key={v.id}>
              <VaquitaCard v={v} onOpen={() => onOpen(v.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
