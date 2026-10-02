"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useCommunities } from "@/hooks/useCommunities";
import { communityNameError, slugError, slugify } from "@/lib/validation";

export default function Page() {
  const { configured, blocker, all, mineIds, loading, error, create, join } = useCommunities();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const onName = (value: string) => {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const bad = communityNameError(name) ?? slugError(slug);
    if (bad) return setFormError(bad);
    setCreating(true);
    const result = await create({ name, slug, description, icon: "" });
    setCreating(false);
    if (!result.ok) return setFormError(result.error);
    setName("");
    setSlug("");
    setSlugEdited(false);
    setDescription("");
  };

  const onJoin = async (id: string) => {
    setJoining(id);
    setJoinError(null);
    const result = await join(id);
    setJoining(null);
    if (!result.ok) setJoinError(result.error);
  };

  if (!configured) {
    return (
      <>
        <h1>Comunidades</h1>
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

  const loggedIn = blocker === null;

  return (
    <>
      <h1>Comunidades</h1>
      <p className="muted">Descubre comunidades, únete o crea la tuya.</p>

      {!loggedIn ? (
        <p className="muted">
          {blocker} <Link href="/">Entrar</Link>
        </p>
      ) : (
        <form className="card profile-form" onSubmit={onCreate} noValidate>
          <h2 style={{ margin: 0 }}>Crear comunidad</h2>
          <div className="field">
            <label htmlFor="c-name">Nombre</label>
            <input id="c-name" value={name} maxLength={50} onChange={(e) => onName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="c-slug">Enlace</label>
            <input
              id="c-slug"
              value={slug}
              maxLength={40}
              autoCapitalize="none"
              spellCheck={false}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value.toLowerCase());
              }}
            />
            <p className="field-hint muted">/c/{slug || "tu-comunidad"}</p>
          </div>
          <div className="field">
            <label htmlFor="c-desc">Descripción</label>
            <textarea id="c-desc" rows={2} maxLength={280} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={creating}>
              {creating ? "Creando…" : "Crear comunidad"}
            </button>
            {formError ? (
              <p className="field-hint error" role="alert">
                {formError}
              </p>
            ) : null}
          </div>
        </form>
      )}

      <h2>Todas las comunidades</h2>
      {loading ? <p className="muted">Cargando…</p> : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {joinError ? (
        <p className="error" role="alert">
          {joinError}
        </p>
      ) : null}
      {!loading && !error && all.length === 0 ? <p className="muted">Todavía no hay comunidades.</p> : null}
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.75rem" }}>
        {all.map((c) => (
          <li key={c.id} className="card">
            <strong>
              <Link href={`/c/${c.slug}`}>{c.name}</Link>
            </strong>
            {c.description ? <p className="muted" style={{ margin: "0.25rem 0 0.5rem" }}>{c.description}</p> : null}
            {mineIds.has(c.id) ? (
              <span className="muted">Eres miembro · </span>
            ) : loggedIn ? (
              <button type="button" className="btn" disabled={joining === c.id} onClick={() => onJoin(c.id)}>
                {joining === c.id ? "Uniéndote…" : "Unirme"}
              </button>
            ) : null}{" "}
            <Link href={`/c/${c.slug}`}>Abrir</Link>
          </li>
        ))}
      </ul>
    </>
  );
}
