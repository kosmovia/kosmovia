"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "../types/index.ts";
import { fromHandle, isUniqueViolation, mapProfile, type ProfileRow } from "../lib/mappers.ts";
import { USERNAME_RE } from "../lib/validation.ts";
import { useSupabase } from "./useSupabase.ts";

export const USERNAME_TAKEN = "Ese @usuario ya está tomado";

export interface ProfileInput {
  username: string;
  displayName: string;
  avatarSeed: string;
  avatarStyle: string;
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
  const { client, session, blocker } = useSupabase();
  const profileId = session?.profileId ?? null;
  const [profile, setProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client || !profileId) {
      setProfile(null);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: err } = await client.from("profiles").select("*").eq("id", profileId).maybeSingle();
    if (err) setError("No se pudo cargar tu perfil.");
    else setProfile(data ? mapProfile(data as ProfileRow) : null);
    setLoading(false);
  }, [client, profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (input: ProfileInput): Promise<ProfileResult> => {
      if (!client || !session) return { ok: false, error: blocker ?? "Entra con tu wallet para continuar." };
      const username = fromHandle(input.username);
      if (!USERNAME_RE.test(username)) return { ok: false, error: "Revisa tu @usuario." };
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
    [client, session, blocker],
  );

  const update = useCallback(
    async (input: Partial<ProfileInput> & { bio?: string }): Promise<ProfileResult> => {
      if (!client || !session) return { ok: false, error: blocker ?? "Entra con tu wallet para continuar." };
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
    [client, session, blocker],
  );

  return { profile, loading, error, blocker, reload: load, create, update };
}
