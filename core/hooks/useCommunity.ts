"use client";

import { useCallback, useEffect, useState } from "react";
import type { Community, User } from "../types/index.ts";
import {
  asRole,
  mapCommunity,
  mapProfile,
  type CommunityRow,
  type MemberRole,
  type ProfileRow,
} from "../lib/mappers.ts";
import { useSupabase } from "./useSupabase.ts";

type MemberWithProfile = { role: string; profile: ProfileRow | null };

export interface CommunityMember extends User {
  memberRole: MemberRole;
}

/** One community by slug (public data), plus members and my role (members only). */
export function useCommunity(slug: string) {
  const { client, session, blocker, configured } = useSupabase();
  const profileId = session?.profileId ?? null;
  const [community, setCommunity] = useState<Community | null>(null);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [myRole, setMyRole] = useState<MemberRole | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await client.from("communities").select("*").eq("slug", slug).maybeSingle();
    if (err) {
      setError("No se pudo cargar la comunidad.");
      setLoading(false);
      return;
    }
    if (!data) {
      setNotFound(true);
      setCommunity(null);
      setLoading(false);
      return;
    }
    setNotFound(false);
    const row = data as CommunityRow;
    setCommunity(mapCommunity(row));

    if (profileId) {
      const { data: mem } = await client
        .from("members")
        .select("role, profile:profiles(*)")
        .eq("community_id", row.id)
        .order("joined_at", { ascending: true });
      const list: CommunityMember[] = [];
      let mine: MemberRole | null = null;
      for (const m of (mem ?? []) as unknown as MemberWithProfile[]) {
        const role = asRole(m.role);
        if (!role || !m.profile) continue;
        const user = mapProfile(m.profile);
        if (user.id === profileId) mine = role;
        list.push({ ...user, memberRole: role });
      }
      setMembers(list);
      setMyRole(mine);
    } else {
      setMembers([]);
      setMyRole(null);
    }
    setLoading(false);
  }, [client, slug, profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { configured, blocker, community, members, myRole, loading, notFound, error, reload: load };
}
