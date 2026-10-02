"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { AvatarPicker } from "@/components/AvatarPicker";
import { AVATAR_STYLE_LABELS, type AvatarSuggestion } from "@/lib/avatar/generator";
import { PollarGate } from "@/lib/pollar";
import { usePollarAuth } from "@/hooks/usePollarAuth";
import { useProfile } from "@/hooks/useProfile";
import { USERNAME_RE, usernameError } from "@/lib/validation";

// Dirección de ejemplo en testnet: solo se usa para mostrar sugerencias cuando no hay sesión.
const DEMO_ADDRESS = "GDEMOKOSMOVIATESTNETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

export default function Page() {
  return (
    <PollarGate fallback={<ProfileForm address={null} />}>
      <WithSession />
    </PollarGate>
  );
}

function WithSession() {
  const { user } = usePollarAuth();
  return <ProfileForm address={user?.address ?? null} />;
}

function ProfileForm({ address }: { address: string | null }) {
  const router = useRouter();
  const userId = useId();
  const nameId = useId();
  const { create, blocker } = useProfile();
  const [username, setUsername] = useState("");
  const [touched, setTouched] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState<AvatarSuggestion | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const error = usernameError(username);
  const showError = touched && error !== null;
  const valid = USERNAME_RE.test(username);
  const canSubmit = valid && avatar !== null && address !== null && blocker === null && !saving;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setSubmitError(null);
    if (!canSubmit || !avatar) return;
    setSaving(true);
    const result = await create({
      username,
      displayName: displayName.trim() || username,
      avatarSeed: avatar.seed,
      avatarStyle: avatar.style,
    });
    setSaving(false);
    if (result.ok) router.push("/comunidades");
    else setSubmitError(result.error);
  };

  let note: string;
  if (address === null) note = "Estás viendo un ejemplo. Entra con tu wallet para guardar tu perfil.";
  else if (blocker) note = blocker;
  else note = "Tu perfil se guarda con tu wallet.";

  return (
    <>
      <h1>Crear perfil</h1>
      <p className="muted">Elige tu @usuario, tu nombre y un avatar generado para ti.</p>
      {address === null ? (
        <p className="muted">
          <Link href="/">Entrar</Link> para usar tu wallet.
        </p>
      ) : null}

      <form className="profile-form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor={userId}>@usuario</label>
          <div className="field-prefix">
            <span aria-hidden="true">@</span>
            <input
              id={userId}
              name="username"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={30}
              placeholder="tu_usuario"
              value={username}
              aria-invalid={showError}
              aria-describedby={`${userId}-hint`}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/^@/, ""))}
              onBlur={() => setTouched(true)}
            />
          </div>
          <p
            id={`${userId}-hint`}
            className={showError ? "field-hint error" : "field-hint muted"}
            role={showError ? "alert" : undefined}
          >
            {showError ? error : "De 3 a 20 caracteres: minúsculas, números y guion bajo."}
          </p>
        </div>

        <div className="field">
          <label htmlFor={nameId}>Nombre visible</label>
          <input
            id={nameId}
            name="displayName"
            type="text"
            autoComplete="off"
            maxLength={40}
            placeholder="Cómo te verán los demás"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>

        <AvatarPicker address={address ?? DEMO_ADDRESS} username={valid ? username : undefined} onChange={setAvatar} />

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={!canSubmit} aria-describedby="profile-submit-note">
            {saving ? "Guardando…" : "Crear perfil"}
          </button>
          <p id="profile-submit-note" className="muted field-hint">
            {note}
            {avatar ? <span className="visually-hidden"> Avatar elegido: {AVATAR_STYLE_LABELS[avatar.style]}.</span> : null}
          </p>
          {submitError ? (
            <p className="field-hint error" role="alert">
              {submitError}
            </p>
          ) : null}
        </div>
      </form>
    </>
  );
}
