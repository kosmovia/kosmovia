"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Avatar } from "@/components/Avatar";
import { useChannels } from "@/hooks/useChannels";
import { useCommunities } from "@/hooks/useCommunities";
import { useCommunity } from "@/hooks/useCommunity";
import { useMessages } from "@/hooks/useMessages";
import { isAvatarStyle } from "@/lib/avatar/generator";
import type { User } from "@/types";

function UserAvatar({ user, size }: { user: User; size: number }) {
  return (
    <Avatar
      seed={user.avatarSeed ?? user.wallet}
      style={isAvatarStyle(user.avatarStyle) ? user.avatarStyle : undefined}
      size={size}
      username={user.username}
    />
  );
}

export default function Page() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const { configured, blocker, community, members, myRole, loading, notFound, error, reload } = useCommunity(slug);
  const { join } = useCommunities();
  const { channels } = useChannels(myRole ? (community?.id ?? null) : null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const active = channels.find((c) => c.id === activeId) ?? channels[0] ?? null;

  if (!configured) {
    return (
      <>
        <h1>Comunidad</h1>
        <div className="card" role="alert">
          <p className="error" style={{ margin: 0 }}>
            {blocker}
          </p>
          <p className="muted" style={{ margin: "0.5rem 0 0" }}>
            Define NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY (ver core/supabase/README.md).
          </p>
        </div>
      </>
    );
  }

  if (loading && !community) return <p className="muted">Cargando…</p>;
  if (error) {
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  }
  if (notFound || !community) {
    return (
      <>
        <h1>Comunidad no encontrada</h1>
        <p className="muted">
          No existe /c/{slug}. <Link href="/comunidades">Ver comunidades</Link>
        </p>
      </>
    );
  }

  const loggedIn = blocker === null;

  if (!myRole) {
    return (
      <>
        <h1>{community.name}</h1>
        {community.description ? <p className="muted">{community.description}</p> : null}
        {loggedIn ? (
          <>
            <p className="muted">Únete para ver los canales y los mensajes.</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                setJoinError(null);
                const result = await join(community.id);
                if (result.ok) await reload();
                else setJoinError(result.error);
              }}
            >
              Unirme
            </button>
            {joinError ? (
              <p className="error" role="alert">
                {joinError}
              </p>
            ) : null}
          </>
        ) : (
          <p className="muted">
            {blocker} <Link href="/">Entrar</Link>
          </p>
        )}
      </>
    );
  }

  const canAdmin = myRole === "owner" || myRole === "admin";

  return (
    <>
      <h1>{community.name}</h1>
      {community.description ? <p className="muted">{community.description}</p> : null}
      <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "minmax(0,1fr)" }}>
        <nav aria-label="Canales" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {channels.map((c) => (
            <button
              key={c.id}
              type="button"
              className={c.id === active?.id ? "btn btn-primary" : "btn"}
              onClick={() => setActiveId(c.id)}
            >
              {c.type === "announcement" ? "📢 " : "# "}
              {c.name}
            </button>
          ))}
        </nav>

        {active ? (
          <ChatPanel
            key={active.id}
            channelId={active.id}
            announcement={active.type === "announcement"}
            canAdmin={canAdmin}
            topic={active.topic}
          />
        ) : (
          <p className="muted">Sin canales todavía.</p>
        )}

        <section aria-label="Miembros" className="card">
          <h2 style={{ marginTop: 0 }}>Miembros ({members.length})</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
            {members.map((m) => (
              <li key={m.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <UserAvatar user={m} size={28} />
                <span>{m.username}</span>
                {m.memberRole !== "member" ? <span className="muted">· {m.memberRole}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

function ChatPanel({
  channelId,
  announcement,
  canAdmin,
  topic,
}: {
  channelId: string;
  announcement: boolean;
  canAdmin: boolean;
  topic?: string;
}) {
  const { messages, loading, error, send } = useMessages(channelId);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const endRef = useRef<HTMLLIElement>(null);
  const readOnly = announcement && !canAdmin;

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length]);

  const submit = async () => {
    if (sending || readOnly) return;
    setSending(true);
    setSendError(null);
    const result = await send(text);
    setSending(false);
    if (result.ok) setText("");
    else setSendError(result.error);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <section aria-label="Mensajes" className="card">
      {topic ? (
        <p className="muted" style={{ marginTop: 0 }}>
          {topic}
        </p>
      ) : null}
      {loading && messages.length === 0 ? <p className="muted">Cargando mensajes…</p> : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && messages.length === 0 ? <p className="muted">Todavía no hay mensajes.</p> : null}
      <ul
        style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.75rem", maxHeight: "50vh", overflowY: "auto" }}
        aria-live="polite"
      >
        {messages.map((m) => (
          <li key={m.id} style={{ display: "flex", gap: "0.5rem" }}>
            <UserAvatar user={m.author} size={32} />
            <div>
              <strong>{m.author.username}</strong>{" "}
              <span className="muted" style={{ fontSize: "0.8rem" }}>
                {new Date(m.createdAt).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
              </span>
              <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.content}</div>
            </div>
          </li>
        ))}
        <li ref={endRef} aria-hidden="true" />
      </ul>

      <div className="field" style={{ marginTop: "1rem" }}>
        <label htmlFor="composer" className="visually-hidden">
          Escribe un mensaje
        </label>
        <textarea
          id="composer"
          rows={2}
          maxLength={2000}
          value={text}
          disabled={readOnly || sending}
          placeholder={
            readOnly ? "Solo owner y admin escriben en este canal" : "Escribe un mensaje (Enter envía, Shift+Enter salto de línea)"
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {sendError ? (
          <p className="field-hint error" role="alert">
            {sendError}
          </p>
        ) : null}
      </div>
    </section>
  );
}
