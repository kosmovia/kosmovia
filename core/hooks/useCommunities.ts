"use client";

import { useCallback, useEffect, useState } from "react";
import type { Community } from "../types/index.ts";
import { isUniqueViolation, mapCommunity, type CommunityRow } from "../lib/mappers.ts";
import { communityNameError, slugError } from "../lib/validation.ts";
import { useSupabase } from "./useSupabase.ts";

export type CommunityResult = { ok: true; community: Community } | { ok: false; error: string };
export type JoinResult = { ok: true } | { ok: false; error: string };

export interface CommunityInput {
  name: string;
  slug: string;
  description: string;
  icon: string;
}

/** All communities (Explore), which ones are mine, create and join. */
export function useCommunities() {
  const { client, session, blocker, configured } = useSupabase();
  const profileId = session?.profileId ?? null;
  const [all, setAll] = useState<Community[]>([]);
  const [mineIds, setMineIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await client
      .from("communities")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (err) {
      setError("No se pudieron cargar las comunidades.");
      setLoading(false);
      return;
    }
    setAll(((data ?? []) as CommunityRow[]).map((r) => mapCommunity(r)));

    if (profileId) {
      const { data: mem } = await client.from("members").select("community_id").eq("profile_id", profileId);
      setMineIds(new Set(((mem ?? []) as { community_id: string }[]).map((m) => m.community_id)));
    } else {
      setMineIds(new Set());
    }
    setLoading(false);
  }, [client, profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (input: CommunityInput): Promise<CommunityResult> => {
      if (!client || !profileId) return { ok: false, error: blocker ?? "Entra con tu wallet para continuar." };
      const name = input.name.trim();
      const slug = input.slug.trim();
      const bad = communityNameError(name) ?? slugError(slug);
      if (bad) return { ok: false, error: bad };
      const { data, error: err } = await client
        .from("communities")
        .insert({ name, slug, description: input.description.trim(), icon: input.icon.trim(), owner_id: profileId })
        .select("*")
        .single();
      if (err) {
        if (isUniqueViolation(err)) return { ok: false, error: "Ese enlace ya está en uso" };
        if (err.code === "23503") return { ok: false, error: "Crea tu perfil antes de crear una comunidad." };
        return { ok: false, error: "No se pudo crear la comunidad. Intenta de nuevo." };
      }
      const community = mapCommunity(data as CommunityRow);
      setAll((prev) => [community, ...prev]);
      setMineIds((prev) => new Set(prev).add(community.id));
      return { ok: true, community };
    },
    [client, profileId, blocker],
  );

  const join = useCallback(
    async (communityId: string): Promise<JoinResult> => {
      if (!client || !profileId) return { ok: false, error: blocker ?? "Entra con tu wallet para continuar." };
      const { error: err } = await client
        .from("members")
        .insert({ community_id: communityId, profile_id: profileId, role: "member" });
      // Already a member counts as joined.
      if (err && !isUniqueViolation(err)) {
        if (err.code === "23503") return { ok: false, error: "Crea tu perfil antes de unirte." };
        return { ok: false, error: "No se pudo unir. Intenta de nuevo." };
      }
      setMineIds((prev) => new Set(prev).add(communityId));
      return { ok: true };
    },
    [client, profileId, blocker],
  );

  const mine = all.filter((c) => mineIds.has(c.id));

  return { configured, blocker, all, mine, mineIds, loading, error, reload: load, create, join };
}
