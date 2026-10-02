"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { isApiBackend } from "@/lib/backend";
import { sugerirUsernames, usernameAleatorio } from "@/lib/usernames";

export interface UsernameSuggestionsProps {
  /** Hay sesión: en modo api se piden al servidor ya filtradas (solo libres). */
  canAskServer: boolean;
  onPick: (username: string) => void;
  /** Se llama una vez con la primera sugerencia, para precargar el campo. */
  onFirst?: (username: string) => void;
}

const COUNT = 6;

/** Chips de @usuarios temáticos + "Aleatorio" + "Otras". */
export function UsernameSuggestions({ canAskServer, onPick, onFirst }: UsernameSuggestionsProps) {
  const [items, setItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const firstSent = useRef(false);
  const onFirstRef = useRef(onFirst);
  onFirstRef.current = onFirst;

  const refresh = useCallback(async () => {
    let next: string[] | null = null;
    if (canAskServer && isApiBackend()) {
      setLoading(true);
      const res = await apiRequest<{ usernames: string[] }>("/api/usernames/sugerencias");
      setLoading(false);
      if (res.ok && res.data.usernames.length > 0) next = res.data.usernames;
    }
    // Sin servidor (o si falla): sugerencias locales; la base avisa si alguna ya está tomada.
    next ??= sugerirUsernames(COUNT);
    setItems(next);
    if (!firstSent.current && next[0]) {
      firstSent.current = true;
      onFirstRef.current?.(next[0]);
    }
  }, [canAskServer]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="name-suggest">
      <div className="name-suggest-chips" role="list" aria-label="Sugerencias de @usuario" aria-busy={loading}>
        {items.map((u) => (
          <button key={u} type="button" role="listitem" className="name-chip" onClick={() => onPick(u)}>
            @{u}
          </button>
        ))}
      </div>
      <div className="name-suggest-actions">
        <button type="button" className="btn" onClick={() => onPick(usernameAleatorio())}>
          Aleatorio
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
          Otras
        </button>
      </div>
    </div>
  );
}
