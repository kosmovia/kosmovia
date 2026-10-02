"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Avatar } from "./Avatar";
import {
  AVATAR_STYLE_LABELS,
  randomSeed,
  suggestions,
  type AvatarSuggestion,
} from "@/lib/avatar/generator";

export interface AvatarPickerProps {
  /** Dirección de la wallet: de aquí salen las 6 sugerencias iniciales. */
  address: string;
  /** Para el texto accesible de la vista previa. */
  username?: string;
  onChange?: (value: AvatarSuggestion) => void;
}

const COUNT = 6;

export function AvatarPicker({ address, username, onChange }: AvatarPickerProps) {
  const labelId = useId();
  const [options, setOptions] = useState<AvatarSuggestion[]>(() => suggestions(address, COUNT));
  const [selected, setSelected] = useState(0);
  const [isRandom, setIsRandom] = useState(false);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Si cambia la dirección, se vuelve a las sugerencias de esa wallet.
  useEffect(() => {
    setOptions(suggestions(address, COUNT));
    setSelected(0);
    setIsRandom(false);
  }, [address]);

  const current = options[selected] ?? options[0];

  useEffect(() => {
    if (current) onChangeRef.current?.(current);
  }, [current]);

  const choose = useCallback((i: number, focus = false) => {
    setSelected(i);
    if (focus) refs.current[i]?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = options.length;
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % n;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next >= 0) {
      e.preventDefault();
      choose(next, true);
    }
  };

  const shuffle = () => {
    setOptions(suggestions(randomSeed(), COUNT));
    setSelected(0);
    setIsRandom(true);
  };

  return (
    <div className="avatar-picker">
      <div className="avatar-picker-main">
        <div className="avatar-picker-options">
          <p id={labelId} className="avatar-picker-label">
            Elige tu avatar
          </p>
          <div role="radiogroup" aria-labelledby={labelId} className="avatar-grid">
            {options.map((o, i) => {
              const checked = i === selected;
              return (
                <button
                  key={o.seed}
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-label={`Opción ${i + 1}: ${AVATAR_STYLE_LABELS[o.style]}`}
                  tabIndex={checked ? 0 : -1}
                  className="avatar-option"
                  onClick={() => choose(i)}
                  onKeyDown={(e) => onKeyDown(e, i)}
                >
                  <Avatar seed={o.seed} style={o.style} size={88} className="avatar-option-img" />
                </button>
              );
            })}
          </div>
          <button type="button" className="btn avatar-shuffle" onClick={shuffle}>
            <span aria-hidden="true">✦</span> Aleatorio
          </button>
          <p className="muted avatar-hint">
            {isRandom
              ? "Estas son nuevas opciones al azar. Pulsa Aleatorio para ver otras."
              : "Salen de tu wallet. Pulsa Aleatorio si quieres ver otras."}
          </p>
        </div>

        <figure className="avatar-preview">
          <Avatar
            seed={current.seed}
            style={current.style}
            size={160}
            username={username}
            className="avatar-preview-img"
          />
          <figcaption aria-live="polite">
            <strong>{AVATAR_STYLE_LABELS[current.style]}</strong>
            <span className="muted"> · Opción {selected + 1} de {options.length}</span>
          </figcaption>
        </figure>
      </div>
    </div>
  );
}
