"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "../types/index.ts";
import { apiRequest } from "../lib/api-client.ts";
import { isApiBackend } from "../lib/backend.ts";
import { fromHandle, isUniqueViolation, mapProfile, type ProfileRow } from "../lib/mappers.ts";
import { isAvatarStyle, isValidAvatarSeed } from "../lib/avatar/generator.ts";
import { USERNAME_RE } from "../lib/validation.ts";
import { useSupabase } from "./useSupabase.ts";

export const USERNAME_TAKEN = "Ese @usuario ya está tomado";

export interface ProfileInput {
  username: string;
  displayName: string;
  avatarSeed: string;
  avatarStyle: string;
}

const DISPLAY_NAME_MAX = 40;
const BIO_MAX = 280;

/** Client-side mirror of the CHECKs in 0001/0002 (avatar seed and style, name and bio length). */
function profileInputError(input: Partial<ProfileInput> & { bio?: string }): string | null {
  if (input.avatarSeed !== undefined && !isValidAvatarSeed(input.avatarSeed)) {
    return "Ese avatar no es válido. Elige otro.";
  }
  if (input.avatarStyle !== undefined && !isAvatarStyle(input.avatarStyle)) {
    return "Ese estilo de avatar no es válido. Elige otro.";
  }
  if (input.displayName !== undefined && input.displayName.trim().length > DISPLAY_NAME_MAX) {
    return `El nombre debe tener ${DISPLAY_NAME_MAX} caracteres como máximo.`;
  }
  if (input.bio !== undefined && input.bio.trim().length > BIO_MAX) {
    return `La bio debe tener ${BIO_MAX} caracteres como máximo.`;
  }
  return null;
}

export type ProfileResult = { ok: true; profile: User } | { ok: false; error: string };

type PgError = { code?: string; message?: string; details?: string } | null;

function describeError(error: NonNullable<PgError>): string {
  if (isUniqueViolation(error)) {
    const text = `${error.message ?? ""} ${error.details ?? ""}`;
    if (/username/i.test(text)) return USERNAME_TAKEN;
    return "Ya tienes un perfil creado.";
  }
  if (error.code === "23514") return "Revisa tu @usuario y tu nombre: no cumplen el formato.";
  return "No se pudo guardar el perfil. Intenta de nuevo.";
}

/** Own profile: read, create and update. */
export function useProfile() {
  const { client, session, blocker, configured } = useSupabase();
  const api = isApiBackend();
  const profileId = session?.profileId ?? null;
  const [profile, setProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!configured || !profileId) {
      setProfile(null);
      return;
    }
    setLoading(true);
    setError(null);
    if (api) {
      const res = await apiRequest<{ profile: ProfileRow | null }>("/api/profile");
      if (!res.ok) setError(res.status === 503 ? res.error : "No se pudo cargar tu perfil.");
      else setProfile(res.data.profile ? mapProfile(res.data.profile) : null);
    } else if (client) {
      const { data, error: err } = await client.from("profiles").select("*").eq("id", profileId).maybeSingle();
      if (err) setError("No se pudo cargar tu perfil.");
      else setProfile(data ? mapProfile(data as ProfileRow) : null);
    }
    setLoading(false);
  }, [api, configured, client, profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (input: ProfileInput): Promise<ProfileResult> => {
      if (!configured || !session) return { ok: false, error: blocker ?? "Entra con tu wallet para continuar." };
      const username = fromHandle(input.username);
      if (!USERNAME_RE.test(username)) return { ok: false, error: "Revisa tu @usuario." };
      const invalid = profileInputError(input);
      if (invalid) return { ok: false, error: invalid };

      if (api) {
        // The server takes the id and wallet from the session cookie, not from here.
        const res = await apiRequest<{ profile: ProfileRow }>("/api/profile", {
          method: "POST",
          body: {
            username,
            displayName: input.displayName.trim(),
            avatarSeed: input.avatarSeed,
            avatarStyle: input.avatarStyle,
          },
        });
        if (!res.ok) return { ok: false, error: res.error };
        const mapped = mapProfile(res.data.profile);
        setProfile(mapped);
        return { ok: true, profile: mapped };
      }

      if (!client) return { ok: false, error: blocker ?? "Entra con tu wallet para continuar." };
      const { data, error: err } = await client
        .from("profiles")
        .insert({
          id: session.profileId,
          wallet: session.address,
          username,
          display_name: input.displayName.trim(),
          avatar_seed: input.avatarSeed,
          avatar_style: input.avatarStyle,
        })
        .select("*")
        .single();
      if (err) return { ok: false, error: describeError(err) };
      const mapped = mapProfile(data as ProfileRow);
      setProfile(mapped);
      return { ok: true, profile: mapped };
    },
    [api, configured, client, session, blocker],
  );

  const update = useCallback(
    async (input: Partial<ProfileInput> & { bio?: string }): Promise<ProfileResult> => {
      if (!configured || !session) return { ok: false, error: blocker ?? "Entra con tu wallet para continuar." };
      const invalid = profileInputError(input);
      if (invalid) return { ok: false, error: invalid };

      if (api) {
        const body: Record<string, string> = {};
        if (input.username !== undefined) {
          const username = fromHandle(input.username);
          if (!USERNAME_RE.test(username)) return { ok: false, error: "Revisa tu @usuario." };
          body.username = username;
        }
        if (input.displayName !== undefined) body.displayName = input.displayName.trim();
        if (input.avatarSeed !== undefined) body.avatarSeed = input.avatarSeed;
        if (input.avatarStyle !== undefined) body.avatarStyle = input.avatarStyle;
        if (input.bio !== undefined) body.bio = input.bio.trim();
        const res = await apiRequest<{ profile: ProfileRow }>("/api/profile", { method: "PATCH", body });
        if (!res.ok) return { ok: false, error: res.error };
        const mapped = mapProfile(res.data.profile);
        setProfile(mapped);
        return { ok: true, profile: mapped };
      }

      if (!client) return { ok: false, error: blocker ?? "Entra con tu wallet para continuar." };
      const patch: Record<string, string> = {};
      if (input.username !== undefined) {
        const username = fromHandle(input.username);
        if (!USERNAME_RE.test(username)) return { ok: false, error: "Revisa tu @usuario." };
        patch.username = username;
      }
      if (input.displayName !== undefined) patch.display_name = input.displayName.trim();
      if (input.avatarSeed !== undefined) patch.avatar_seed = input.avatarSeed;
      if (input.avatarStyle !== undefined) patch.avatar_style = input.avatarStyle;
      if (input.bio !== undefined) patch.bio = input.bio.trim();
      const { data, error: err } = await client
        .from("profiles")
        .update(patch)
        .eq("id", session.profileId)
        .select("*")
        .single();
      if (err) return { ok: false, error: describeError(err) };
      const mapped = mapProfile(data as ProfileRow);
      setProfile(mapped);
      return { ok: true, profile: mapped };
    },
    [api, configured, client, session, blocker],
  );

  return { profile, loading, error, blocker, reload: load, create, update };
}
