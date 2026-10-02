"use client";

import { useCallback, useEffect, useState } from "react";
import type { Channel } from "../types/index.ts";
import { mapChannel, type ChannelRow } from "../lib/mappers.ts";
import { useSupabase } from "./useSupabase.ts";

/** Channels of one community (only visible to its members). */
export function useChannels(communityId: string | null) {
  const { client, session, blocker } = useSupabase();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasSession = session !== null;

  const load = useCallback(async () => {
    if (!client || !hasSession || !communityId) {
      setChannels([]);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: err } = await client
      .from("channels")
      .select("*")
      .eq("community_id", communityId)
      .order("created_at", { ascending: true });
    if (err) setError("No se pudieron cargar los canales.");
    else setChannels(((data ?? []) as ChannelRow[]).map(mapChannel));
    setLoading(false);
  }, [client, hasSession, communityId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { channels, loading, error, blocker, reload: load };
}
