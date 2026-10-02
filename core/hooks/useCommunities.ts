"use client";

import { useCallback, useEffect, useState } from "react";
import type { Community } from "../types/index.ts";
import { apiRequest } from "../lib/api-client.ts";
import { isApiBackend } from "../lib/backend.ts";
import { isUniqueViolation, mapCommunity, quotaMessage, type CommunityRow } from "../lib/mappers.ts";
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
  const api = isApiBackend();
  const profileId = session?.profileId ?? null;
  const [all, setAll] = useState<Community[]>([]);
  const [mineIds, setMineIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!configured) return;
    setLoading(true);
    setError(null);

    if (api) {
      const res = await apiRequest<{ communities: CommunityRow[]; mine: string[] }>("/api/communities");
      if (!res.ok) {
        setError(res.status === 503 ? res.error : "No se pudieron cargar las comunidades.");
        setLoading(false);
        return;
      }
      setAll(res.data.communities.map((r) => mapCommunity(r)));
      setMineIds(new Set(profileId ? res.data.mine : []));
      setLoading(false);
      return;
    }

    if (!client) return;
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
  }, [api, configured, client, profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (input: CommunityInput): Promise<CommunityResult> => {
      if (!configured || !profileId) return { ok: false, error: blocker ?? "Entra con tu wallet para continuar." };
      const name = input.name.trim();
      const slug = input.slug.trim();
      const bad = communityNameError(name) ?? slugError(slug);
      if (bad) return { ok: false, error: bad };

      if (api) {
        const res = await apiRequest<{ community: CommunityRow }>("/api/communities", {
          method: "POST",
          body: { name, slug, description: input.description.trim(), icon: input.icon.trim() },
        });
        if (!res.ok) return { ok: false, error: res.error };
        const community = mapCommunity(res.data.community);
        setAll((prev) => [community, ...prev]);
        setMineIds((prev) => new Set(prev).add(community.id));
        return { ok: true, community };
      }

      if (!client) return { ok: false, error: blocker ?? "Entra con tu wallet para continuar." };
      const { data, error: err } = await client
        .from("communities")
        .insert({ name, slug, description: input.description.trim(), icon: input.icon.trim(), owner_id: profileId })
        .select("*")
        .single();
      if (err) {
        if (isUniqueViolation(err)) return { ok: false, error: "Ese enlace ya está en uso" };
        if (err.code === "23503") return { ok: false, error: "Crea tu perfil antes de crear una comunidad." };
        return { ok: false, error: quotaMessage(err) ?? "No se pudo crear la comunidad. Intenta de nuevo." };
      }
      const community = mapCommunity(data as CommunityRow);
      setAll((prev) => [community, ...prev]);
      setMineIds((prev) => new Set(prev).add(community.id));
      return { ok: true, community };
    },
    [api, configured, client, profileId, blocker],
  );

  /**
   * `slug` is only needed with the api backend (its join route is
   * /api/communities/[slug]/join); when omitted it is looked up in the loaded list.
   */
  const join = useCallback(
    async (communityId: string, slug?: string): Promise<JoinResult> => {
      if (!configured || !profileId) return { ok: false, error: blocker ?? "Entra con tu wallet para continuar." };

      if (api) {
        const target = slug ?? all.find((c) => c.id === communityId)?.slug;
        if (!target) return { ok: false, error: "No se pudo unir. Intenta de nuevo." };
        const res = await apiRequest<{ ok: true }>(`/api/communities/${encodeURIComponent(target)}/join`, {
          method: "POST",
        });
        if (!res.ok) return { ok: false, error: res.status === 409 ? res.error : "No se pudo unir. Intenta de nuevo." };
        setMineIds((prev) => new Set(prev).add(communityId));
        return { ok: true };
      }

      if (!client) return { ok: false, error: blocker ?? "Entra con tu wallet para continuar." };
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
    [api, configured, client, profileId, blocker, all],
  );

  const mine = all.filter((c) => mineIds.has(c.id));

  return { configured, blocker, all, mine, mineIds, loading, error, reload: load, create, join };
}
