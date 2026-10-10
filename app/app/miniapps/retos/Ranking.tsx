'use client';

import { useCallback, useEffect, useState } from 'react';
import { retosService, type RetoRankingEntry } from '@/services';
import type { MiniAppUser } from '@/lib/miniapp-sdk/client';
import s from './retos.module.css';
import { Avatar, BackHeader, ErrorBox, SkeletonBlock } from './ui';
import { errText, handle } from './util';

export default function Ranking({ slug, user, onBack }: { slug: string; user: MiniAppUser; onBack: () => void }) {
  const [rows, setRows] = useState<RetoRankingEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    try {
      setRows(await retosService.ranking(slug));
    } catch (e) {
      setError(errText(e, 'No pudimos cargar la tabla de posiciones.'));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = (r: RetoRankingEntry) => r.user.id === user.id || handle(r.user).toLowerCase() === handle(user).toLowerCase();

  return (
    <div className={s.wrap}>
      <BackHeader title="Posiciones" onBack={onBack} />
      <p className={s.muted}>Ganar suma 3 puntos y empatar, 1. Solo cuentan los retos terminados.</p>

      {error && <ErrorBox message={error} onRetry={() => void load()} />}

      {rows === null && !error && (
        <div className={s.stack} role="status" aria-live="polite">
          <span className={s.srOnly}>Cargando posiciones…</span>
          <SkeletonBlock h={64} />
          <SkeletonBlock h={64} />
          <SkeletonBlock h={64} />
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <div className={s.empty}>
          <div className={s.emptyTitle}>Todavía nadie tiene puntos</div>
          <p className={s.muted}>Termina un reto y serás el primero de la tabla.</p>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <>
          <div className={s.rankHead} aria-hidden="true">
            <span />
            <span />
            <span className={s.rankCols}>
              <span>G</span>
              <span>E</span>
              <span>P</span>
            </span>
            <span className={s.rankPts}>Pts</span>
          </div>
          <ol className={s.list}>
            {rows.map((r) => (
              <li key={r.user.id} className={`${s.rankRow} ${mine(r) ? s.rankMine : ''}`} aria-current={mine(r) ? 'true' : undefined}>
                <span className={`${s.rankNum} ${r.rank <= 3 ? s[`rank${r.rank}`] : ''}`}>{r.rank}</span>
                <span className={s.rankWho}>
                  <Avatar user={r.user} size={40} />
                  <span className={s.retoBody}>
                    <span className={s.retoTitle}>
                      {r.user.displayName}
                      {mine(r) && <span className={s.youTag}>Tú</span>}
                    </span>
                    <span className={s.retoGame}>{handle(r.user)}</span>
                  </span>
                </span>
                <span className={s.rankCols}>
                  <span>{r.wins}<span className={s.srOnly}> ganados</span></span>
                  <span>{r.draws}<span className={s.srOnly}> empates</span></span>
                  <span>{r.losses}<span className={s.srOnly}> perdidos</span></span>
                </span>
                <span className={s.rankPts}>
                  {r.points}
                  <span className={s.srOnly}> puntos</span>
                </span>
              </li>
            ))}
          </ol>
          <p className={s.legend}>G ganados · E empates · P perdidos</p>
        </>
      )}
    </div>
  );
}
