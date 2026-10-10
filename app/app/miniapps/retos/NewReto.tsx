'use client';

import { useEffect, useMemo, useState } from 'react';
import { communityService, retosService, type Reto, type RetoGame } from '@/services';
import type { User } from '@/types';
import { kosmovia, MiniAppError, type MiniAppUser } from '@/lib/miniapp-sdk/client';
import s from './retos.module.css';
import { Avatar, BackHeader, ErrorBox, HandIcon, Mark } from './ui';
import { GAME_NAME, errText, handle } from './util';

export function shareText(game: RetoGame, rival: User): string {
  return `¡Te reto a ${GAME_NAME[game]}, ${handle(rival)}! Abre Retos para aceptar y jugar. Sin apuestas, solo por diversión.`;
}

/** Botón "Avisar en el canal" con su estado (publicado, cancelado, error). */
export function ShareButton({ text, primary = true }: { text: string; primary?: boolean }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [msg, setMsg] = useState<string | null>(null);

  async function share() {
    setState('sending');
    setMsg(null);
    try {
      await kosmovia.share(text);
      setState('done');
    } catch (e) {
      setState('idle');
      if (e instanceof MiniAppError && e.code === 'user_rejected') setMsg('No se publicó nada. Puedes avisar cuando quieras.');
      else setMsg('No pudimos publicar en el canal. Intenta de nuevo.');
    }
  }

  return (
    <>
      <button
        type="button"
        className={`${s.btn} ${primary ? s.btnPrimary : s.btnGhost} ${s.btnBlock}`}
        onClick={() => void share()}
        disabled={state === 'sending'}
      >
        {state === 'sending' ? 'Publicando…' : state === 'done' ? 'Avisar de nuevo en el canal' : 'Avisar en el canal'}
      </button>
      {state === 'done' && (
        <div className={s.softNote} role="status">
          ¡Listo! Avisamos en el canal.
        </div>
      )}
      {msg && (
        <div className={s.softNote} role="status">
          {msg}
        </div>
      )}
    </>
  );
}

export default function NewReto({
  slug,
  user,
  initialGame,
  initialOpponent,
  onBack,
  onOpen,
}: {
  slug: string;
  user: MiniAppUser;
  initialGame?: RetoGame;
  initialOpponent?: string;
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  const [game, setGame] = useState<RetoGame | null>(initialGame ?? null);
  const [members, setMembers] = useState<User[] | null>(null);
  const [membersFailed, setMembersFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(initialOpponent ?? null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ reto: Reto; rival: User } | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const list = await communityService.getCommunities();
        const c = list.find((x) => x.slug === slug);
        if (!live) return;
        if (!c) {
          setMembersFailed(true);
          setMembers([]);
          return;
        }
        setMembers(c.members);
      } catch {
        if (live) {
          setMembersFailed(true);
          setMembers([]);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [slug]);

  const norm = (v: string) => v.replace(/^@/, '').trim().toLowerCase();
  const candidates = useMemo(() => {
    const me = norm(user.username);
    const q = norm(query);
    return (members ?? [])
      .filter((m) => m.id !== user.id && norm(m.username) !== me)
      .filter((m) => !q || norm(m.username).includes(q) || m.displayName.toLowerCase().includes(q));
  }, [members, query, user.id, user.username]);

  const typed = norm(query);
  const exact = candidates.some((m) => norm(m.username) === typed);
  const offerTyped = typed.length > 0 && !exact && /^[a-z0-9_.-]+$/i.test(typed);
  const pickedUser = (members ?? []).find((m) => handle(m) === picked) ?? null;

  async function send() {
    if (!game || !picked || sending) return;
    setSending(true);
    setError(null);
    try {
      const reto = await retosService.create(slug, { game, opponent: picked });
      const rival = reto.me === 'challenger' ? reto.opponent : reto.challenger;
      setCreated({ reto, rival });
    } catch (e) {
      setError(errText(e, 'No pudimos crear el reto. Intenta de nuevo.'));
    }
    setSending(false);
  }

  if (created) {
    const { reto, rival } = created;
    return (
      <div className={s.wrap}>
        <div className={s.center}>
          <div className={s.celebrate} aria-hidden="true">
            <Avatar user={rival} size={72} />
          </div>
          <h1 className={s.centerTitle}>¡Reto enviado!</h1>
          <p className={s.muted}>
            Le mandaste un reto de <strong className={s.strong}>{GAME_NAME[reto.game]}</strong> a{' '}
            <strong className={s.strong}>{handle(rival)}</strong>.
            {reto.status === 'active' ? ' Ya puede empezar la partida.' : ' Tiene 24 horas para aceptar.'}
          </p>
          <ShareButton text={shareText(reto.game, rival)} />
          <button type="button" className={`${s.btn} ${s.btnGhost} ${s.btnBlock}`} onClick={() => onOpen(reto.id)}>
            {reto.status === 'active' ? 'Ir a la partida' : 'Ver el reto'}
          </button>
        </div>
      </div>
    );
  }

  const ready = !!game && !!picked;

  return (
    <div className={s.wrap}>
      <BackHeader title="Nuevo reto" onBack={onBack} />

      <fieldset className={s.fieldset}>
        <legend className={s.stepTitle}>
          <span className={s.stepNum}>1</span> Elige el juego
        </legend>
        <div className={s.gameGrid} role="radiogroup" aria-label="Juego">
          <button
            type="button"
            role="radio"
            aria-checked={game === 'ttt'}
            className={`${s.gameCard} ${game === 'ttt' ? s.gameCardOn : ''}`}
            onClick={() => setGame('ttt')}
          >
            <span className={s.gameArt} aria-hidden="true">
              <span className={s.miniMark}>
                <Mark kind="X" animate={false} />
              </span>
              <span className={s.miniMark}>
                <Mark kind="O" animate={false} />
              </span>
            </span>
            <span className={s.gameName}>Tres en raya</span>
            <span className={s.gameHint}>Por turnos</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={game === 'ppt'}
            className={`${s.gameCard} ${game === 'ppt' ? s.gameCardOn : ''}`}
            onClick={() => setGame('ppt')}
          >
            <span className={s.gameArt} aria-hidden="true">
              <HandIcon choice="piedra" size={34} />
              <HandIcon choice="tijera" size={34} />
            </span>
            <span className={s.gameName}>Piedra, papel o tijera</span>
            <span className={s.gameHint}>Al mejor de 3</span>
          </button>
        </div>
      </fieldset>

      <section className={s.fieldset} aria-labelledby="retos-rival">
        <h2 className={s.stepTitle} id="retos-rival">
          <span className={s.stepNum}>2</span> Elige a tu rival
        </h2>
        <label className={s.srOnly} htmlFor="retos-search">
          Buscar por nombre o @usuario
        </label>
        <input
          id="retos-search"
          className={s.input}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="Buscar nombre o @usuario"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {members === null && (
          <p className={s.muted} role="status">
            Cargando a la comunidad…
          </p>
        )}
        {membersFailed && (
          <p className={s.muted}>No pudimos cargar la lista. Escribe el @usuario de tu rival arriba.</p>
        )}
        {members !== null && !membersFailed && candidates.length === 0 && !offerTyped && (
          <p className={s.muted}>No hay nadie con ese nombre en la comunidad.</p>
        )}
        <ul className={s.memberList} role="radiogroup" aria-label="Rival">
          {offerTyped && (
            <li>
              <button
                type="button"
                role="radio"
                aria-checked={picked === `@${typed}`}
                className={`${s.member} ${picked === `@${typed}` ? s.memberOn : ''}`}
                onClick={() => setPicked(`@${typed}`)}
              >
                <span className={s.avatar} style={{ width: 44, height: 44 }} aria-hidden="true">
                  @
                </span>
                <span className={s.retoBody}>
                  <span className={s.retoTitle}>Retar a @{typed}</span>
                  <span className={s.retoGame}>Usaremos ese @usuario</span>
                </span>
              </button>
            </li>
          )}
          {candidates.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                role="radio"
                aria-checked={picked === handle(m)}
                className={`${s.member} ${picked === handle(m) ? s.memberOn : ''}`}
                onClick={() => setPicked(handle(m))}
              >
                <Avatar user={m} size={44} />
                <span className={s.retoBody}>
                  <span className={s.retoTitle}>{m.displayName}</span>
                  <span className={s.retoGame}>{handle(m)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {error && <ErrorBox message={error} />}

      <div className={s.stickyBar}>
        <button
          type="button"
          className={`${s.btn} ${s.btnPrimary} ${s.btnBlock} ${s.btnBig}`}
          onClick={() => void send()}
          disabled={!ready || sending}
        >
          {sending ? 'Enviando…' : ready ? `Retar a ${pickedUser ? pickedUser.displayName.split(' ')[0] : picked}` : 'Retar'}
        </button>
        {!ready && <p className={s.hint}>Elige un juego y un rival para continuar.</p>}
      </div>
    </div>
  );
}
