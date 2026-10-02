"use client";

import { useId, useState, type FormEvent } from "react";
import { AvatarPicker } from "@/components/AvatarPicker";
import { AVATAR_STYLE_LABELS, type AvatarSuggestion } from "@/lib/avatar/generator";

// Dirección de ejemplo en testnet. Se reemplaza por la de la sesión cuando el login esté conectado.
const DEMO_ADDRESS = "GDEMOKOSMOVIATESTNETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

function usernameError(value: string): string | null {
  if (value.length === 0) return "Escribe tu @usuario.";
  if (!/^[a-z0-9_]*$/.test(value)) return "Solo minúsculas, números y guion bajo.";
  if (value.length < 3) return "Debe tener al menos 3 caracteres.";
  if (value.length > 20) return "Debe tener 20 caracteres como máximo.";
  return null;
}

export default function Page() {
  const userId = useId();
  const nameId = useId();
  const [username, setUsername] = useState("");
  const [touched, setTouched] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState<AvatarSuggestion | null>(null);

  const error = usernameError(username);
  const showError = touched && error !== null;
  const valid = USERNAME_RE.test(username);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
  };

  return (
    <>
      <h1>Crear perfil</h1>
      <p className="muted">Elige tu @usuario, tu nombre y un avatar generado para ti.</p>

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

        <AvatarPicker address={DEMO_ADDRESS} username={valid ? username : undefined} onChange={setAvatar} />

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled aria-describedby="profile-submit-note">
            Crear perfil
          </button>
          <p id="profile-submit-note" className="muted field-hint">
            Se guarda cuando el login esté conectado.
            {avatar ? <span className="visually-hidden"> Avatar elegido: {AVATAR_STYLE_LABELS[avatar.style]}.</span> : null}
          </p>
        </div>
      </form>
    </>
  );
}
