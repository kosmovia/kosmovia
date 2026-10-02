"use client";

import { useCallback, useEffect, useState } from "react";
import type { Channel } from "../types/index.ts";
import { apiRequest } from "../lib/api-client.ts";
import { isApiBackend } from "../lib/backend.ts";
import { mapChannel, type ChannelRow } from "../lib/mappers.ts";
import { useSupabase } from "./useSupabase.ts";

/**
 * Channels of one community (only visible to its members). `slug` is only
 * needed with the api backend (GET /api/communities/[slug]/channels).
 */
export function useChannels(communityId: string | null, slug?: string | null) {
  const { client, session, blocker, configured } = useSupabase();
  const api = isApiBackend();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasSession = session !== null;

  const load = useCallback(async () => {
    if (!configured || !hasSession || !communityId) {
      setChannels([]);
      return;
    }
    setLoading(true);
    setError(null);
    if (api) {
      if (!slug) {
        setChannels([]);
        setLoading(false);
        return;
      }
      const res = await apiRequest<{ channels: ChannelRow[] }>(`/api/communities/${encodeURIComponent(slug)}/channels`);
      if (!res.ok) setError("No se pudieron cargar los canales.");
      else setChannels(res.data.channels.map(mapChannel));
    } else if (client) {
      const { data, error: err } = await client
        .from("channels")
        .select("*")
        .eq("community_id", communityId)
        .order("created_at", { ascending: true });
      if (err) setError("No se pudieron cargar los canales.");
      else setChannels(((data ?? []) as ChannelRow[]).map(mapChannel));
    }
    setLoading(false);
  }, [api, configured, client, hasSession, communityId, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  return { channels, loading, error, blocker, reload: load };
}
