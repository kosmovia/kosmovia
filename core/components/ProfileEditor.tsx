"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { Avatar } from "./Avatar";
import { KosmonautaPicker } from "./KosmonautaPicker";
import { UsernameSuggestions } from "./UsernameSuggestions";
import { PollarGate } from "../lib/pollar.tsx";
import { usePollarAuth } from "../hooks/usePollarAuth.ts";
import { useProfile } from "../hooks/useProfile.ts";
import { fromHandle } from "../lib/mappers.ts";
import { usernameError } from "../lib/validation.ts";
import { AVATAR_COOLDOWN_MS, USERNAME_COOLDOWN_MS, fechaCorta, proximoCambio } from "../lib/cooldowns.ts";

type Notice = { kind: "error" | "ok"; text: string } | null;

/** /perfil: tu avatar y @usuario, y los cambios con su límite (24 h y 3 días). */
export function ProfileEditor() {
  return (
    <PollarGate>
      <Inner />
    </PollarGate>
  );
}

function Inner() {
  const { user } = usePollarAuth();
  const { profile, loading, update } = useProfile();
  const address = user?.address ?? null;

  if (!address) {
    return (
      <p className="muted">
        <Link href="/">Entra</Link> con tu wallet para ver tu perfil.
      </p>
    );
  }
  if (!profile) {
    return loading ? (
      <p className="muted">Cargando tu perfil…</p>
    ) : (
      <p className="muted">
        Todavía no tienes perfil. <Link href="/perfil/nuevo">Créalo aquí</Link>.
      </p>
    );
  }

  return (
    <div className="profile-edit">
      <section className="card profile-head" aria-label="Tu perfil">
        <Avatar seed={profile.avatarSeed || profile.wallet} style={profile.avatarStyle} size={88} username={profile.username} />
        <div>
          <p className="profile-head-name">{profile.displayName}</p>
          <p className="muted profile-head-user">{profile.username}</p>
        </div>
      </section>
      <UsernameCard
        current={fromHandle(profile.username)}
        changedAt={profile.usernameChangedAt}
        save={(username) => update({ username })}
      />
      <AvatarCard
        address={address}
        current={profile.avatarStyle === "kosmonauta" ? profile.avatarSeed : undefined}
        changedAt={profile.avatarChangedAt}
        save={(code) => update({ avatarSeed: code, avatarStyle: "kosmonauta" })}
      />
    </div>
  );
}

type Save = (value: string) => Promise<{ ok: true } | { ok: false; error: string }>;

function UsernameCard({ current, changedAt, save }: { current: string; changedAt?: string; save: Save }) {
  const inputId = useId();
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const next = proximoCambio(changedAt, USERNAME_COOLDOWN_MS);
  const error = value === current ? null : usernameError(value);
  const canSave = !next && !saving && value !== current && error === null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setNotice(null);
    const res = await save(value);
    setSaving(false);
    setNotice(res.ok ? { kind: "ok", text: `Listo: ahora eres @${value}.` } : { kind: "error", text: res.error });
  };

  return (
    <form className="card profile-section" onSubmit={onSubmit} noValidate>
      <h2>Cambiar @usuario</h2>
      {next ? (
        <p className="muted">Podrás cambiarlo de nuevo el {fechaCorta(next)}.</p>
      ) : (
        <>
          <div className="field">
            <label htmlFor={inputId}>Nuevo @usuario</label>
            <div className="field-prefix">
              <span aria-hidden="true">@</span>
              <input
                id={inputId}
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={30}
                value={value}
                aria-invalid={error !== null}
                onChange={(e) => setValue(e.target.value.toLowerCase().replace(/^@/, ""))}
              />
            </div>
            <p className={error ? "field-hint error" : "field-hint muted"}>
              {error ?? "Solo puedes cambiarlo una vez cada 24 horas."}
            </p>
          </div>
          <UsernameSuggestions canAskServer onPick={setValue} />
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={!canSave}>
              {saving ? "Guardando…" : "Guardar @usuario"}
            </button>
          </div>
        </>
      )}
      {notice ? (
        <p className={notice.kind === "error" ? "field-hint error" : "field-hint"} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}
    </form>
  );
}

function AvatarCard({
  address,
  current,
  changedAt,
  save,
}: {
  address: string;
  current?: string;
  changedAt?: string;
  save: Save;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(current ?? null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const next = proximoCambio(changedAt, AVATAR_COOLDOWN_MS);
  const canSave = !next && !saving && code !== null && code !== current;

  const onSave = async () => {
    if (!canSave || !code) return;
    setSaving(true);
    setNotice(null);
    const res = await save(code);
    setSaving(false);
    if (res.ok) {
      setOpen(false);
      setNotice({ kind: "ok", text: "Listo: tu nuevo Kosmonauta ya se ve en tu perfil y en el chat." });
    } else setNotice({ kind: "error", text: res.error });
  };

  return (
    <section className="card profile-section" aria-label="Cambiar Kosmonauta">
      <h2>Cambiar Kosmonauta</h2>
      {next ? (
        <p className="muted">Podrás cambiarlo de nuevo el {fechaCorta(next)}.</p>
      ) : open ? (
        <>
          <KosmonautaPicker address={address} initial={current} onChange={setCode} />
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={onSave} disabled={!canSave}>
              {saving ? "Guardando…" : "Guardar Kosmonauta"}
            </button>
            <p className="muted field-hint">Después de guardarlo no podrás cambiarlo por 3 días.</p>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              Cancelar
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">Puedes cambiarlo una vez cada 3 días.</p>
          <button type="button" className="btn" onClick={() => setOpen(true)}>
            Editar Kosmonauta
          </button>
        </>
      )}
      {notice ? (
        <p className={notice.kind === "error" ? "field-hint error" : "field-hint"} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}
