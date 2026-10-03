"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { KosmonautaPicker } from "@/components/KosmonautaPicker";
import { UsernameSuggestions } from "@/components/UsernameSuggestions";
import { atributos, decodificar } from "@/lib/avatar/kosmonautas";
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
  const [step, setStep] = useState<1 | 2>(1);
  const [username, setUsername] = useState("");
  const [touched, setTouched] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const error = usernameError(username);
  const showError = touched && error !== null;
  const valid = USERNAME_RE.test(username);
  const canAdvance = valid;
  const canSubmit = valid && avatar !== null && address !== null && blocker === null && !saving;

  const goNext = () => {
    setTouched(true);
    if (canAdvance) setStep(2);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setSubmitError(null);
    if (!canSubmit || !avatar) return;
    setSaving(true);
    const result = await create({
      username,
      displayName: displayName.trim() || username,
      avatarSeed: avatar,
      avatarStyle: "kosmonauta",
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
      <p className="muted">Elige tu @usuario, tu nombre y arma tu Kosmonauta.</p>
      {address === null ? (
        <p className="muted">
          <Link href="/">Entrar</Link> para usar tu wallet.
        </p>
      ) : null}

      <div className="stepper">
        <div className="stepper-step" data-state={step === 1 ? "active" : "done"}>
          <div className="stepper-bar" />
          <span className="stepper-label">1. Usuario</span>
        </div>
        <div className="stepper-step" data-state={step === 2 ? "active" : "pending"}>
          <div className="stepper-bar" />
          <span className="stepper-label">2. Kosmonauta</span>
        </div>
      </div>

      <form className="profile-form" onSubmit={onSubmit} noValidate>
        {step === 1 ? (
          <>
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
                {showError ? error : "De 3 a 20 caracteres: minúsculas, números y guion bajo. Podrás cambiarlo una vez cada 24 horas."}
              </p>
              <UsernameSuggestions
                canAskServer={address !== null}
                onPick={(u) => {
                  setUsername(u);
                  setTouched(true);
                }}
                onFirst={(u) => setUsername((cur) => cur || u)}
              />
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

            <div className="form-actions">
              <button type="button" className="btn btn-primary" disabled={!canAdvance} onClick={goNext}>
                Siguiente
              </button>
              {showError ? (
                <p className="field-hint error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <KosmonautaPicker address={address ?? DEMO_ADDRESS} onChange={setAvatar} />

            <div className="form-actions" style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>
                Atrás
              </button>
              <button type="submit" className="btn btn-primary" disabled={!canSubmit} aria-describedby="profile-submit-note">
                {saving ? "Guardando…" : "Crear perfil"}
              </button>
            </div>
            <p id="profile-submit-note" className="muted field-hint">
              {note}
              {avatar ? (
                <span className="visually-hidden">
                  {" "}
                  Avatar elegido:{" "}
                  {atributos(decodificar(avatar))
                    .slice(0, -1)
                    .map((a) => `${a.trait_type} ${a.value}`)
                    .join(", ")}
                  .
                </span>
              ) : null}
            </p>
            {submitError ? (
              <p className="field-hint error" role="alert">
                {submitError}
              </p>
            ) : null}
          </>
        )}
      </form>
    </>
  );
}
