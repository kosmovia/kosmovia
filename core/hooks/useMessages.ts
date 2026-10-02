"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Message, User } from "../types/index.ts";
import {
  AUTHOR_COLUMNS,
  capMessages,
  mapAuthor,
  mapMessage,
  MAX_LOADED_HISTORY,
  MAX_WINDOW,
  mergeMessages,
  MESSAGE_COLUMNS,
  olderThanFilter,
  PAGE_SIZE,
  quotaMessage,
  type AuthorRow,
  type MessageRow,
} from "../lib/mappers.ts";
import { cleanMessage } from "../lib/validation.ts";
import { useSupabase } from "./useSupabase.ts";

export { PAGE_SIZE };

/** Authors remembered per hook instance, at most (oldest forgotten first). */
const MAX_CACHED_AUTHORS = 500;

export type SendResult = { ok: true } | { ok: false; error: string };

/**
 * Messages of a channel: the newest page, live inserts via Realtime, "load
 * older" pagination, and sending.
 *
 * - Memory is bounded: at most MAX_WINDOW (200) messages, growing by one page
 *   per "Cargar anteriores" up to MAX_LOADED_HISTORY; live inserts push the
 *   oldest out once the cap is reached.
 * - Messages are fetched without any author columns, and each author profile
 *   (only id, username, display_name, avatar_seed, avatar_style) is fetched
 *   once and cached by id, in batches, instead of once per message.
 */
export function useMessages(channelId: string | null) {
  const { client, session, blocker } = useSupabase();
  const hasSession = session !== null;
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authors = useRef(new Map<string, User>());
  const pendingAuthors = useRef(new Map<string, Promise<void>>());
  /** Source of truth for the list, so every update sees the previous one. */
  const listRef = useRef<Message[]>([]);
  const capRef = useRef(MAX_WINDOW);

  const commit = useCallback((next: Message[]) => {
    listRef.current = next;
    setMessages(next);
  }, []);

  /** Makes sure every id is in the cache: one batched query for the ones that are not. */
  const loadAuthors = useCallback(
    async (ids: string[]): Promise<void> => {
      if (!client) return;
      const waits: Promise<void>[] = [];
      const toFetch: string[] = [];
      for (const id of new Set(ids)) {
        if (authors.current.has(id)) continue;
        const inFlight = pendingAuthors.current.get(id);
        if (inFlight) waits.push(inFlight);
        else toFetch.push(id);
      }
      if (toFetch.length > 0) {
        const batch = (async () => {
          const { data } = await client.from("profiles").select(AUTHOR_COLUMNS).in("id", toFetch);
          const cache = authors.current;
          for (const row of (data ?? []) as AuthorRow[]) {
            cache.set(row.id, mapAuthor(row));
            while (cache.size > MAX_CACHED_AUTHORS) {
              const oldest = cache.keys().next();
              if (oldest.done) break;
              cache.delete(oldest.value);
            }
          }
        })().finally(() => {
          for (const id of toFetch) pendingAuthors.current.delete(id);
        });
        for (const id of toFetch) pendingAuthors.current.set(id, batch);
        waits.push(batch);
      }
      await Promise.all(waits);
    },
    [client],
  );

  const toMessages = useCallback((rows: MessageRow[]): Message[] => {
    const out: Message[] = [];
    for (const row of rows) {
      const author = authors.current.get(row.author_id);
      if (author) out.push(mapMessage(row, author));
    }
    return out;
  }, []);

  useEffect(() => {
    commit([]);
    capRef.current = MAX_WINDOW;
    setHasMore(false);
    setError(null);
    if (!client || !hasSession || !channelId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      const { data, error: err } = await client
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .eq("channel_id", channelId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE);
      if (cancelled) return;
      if (err) {
        setError("No se pudieron cargar los mensajes.");
        setLoading(false);
        return;
      }
      const rows = (data ?? []) as MessageRow[];
      await loadAuthors(rows.map((r) => r.author_id));
      if (cancelled) return;
      commit(capMessages(mergeMessages(listRef.current, toMessages(rows)), capRef.current));
      setHasMore(rows.length === PAGE_SIZE);
      setLoading(false);
    })();

    const channel = client
      .channel(`messages:${channelId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `channel_id=eq.${channelId}` },
        async (payload) => {
          const row = payload.new as MessageRow;
          await loadAuthors([row.author_id]);
          if (cancelled) return;
          const incoming = toMessages([row]);
          if (incoming.length === 0) return;
          const merged = mergeMessages(listRef.current, incoming);
          const capped = capMessages(merged, capRef.current);
          // Pushing the oldest out means there is older history to load again.
          if (capped.length < merged.length) setHasMore(true);
          commit(capped);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void client.removeChannel(channel);
    };
  }, [client, hasSession, channelId, loadAuthors, toMessages, commit]);

  const loadOlder = useCallback(async (): Promise<void> => {
    if (!client || !hasSession || !channelId || loadingOlder || !hasMore) return;
    const oldest = listRef.current[0];
    if (!oldest) return;
    const filter = olderThanFilter(oldest);
    if (!filter) {
      setHasMore(false);
      return;
    }
    setLoadingOlder(true);
    const { data, error: err } = await client
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("channel_id", channelId)
      .or(filter)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE);
    if (err) {
      setError("No se pudieron cargar los mensajes anteriores.");
      setLoadingOlder(false);
      return;
    }
    const rows = (data ?? []) as MessageRow[];
    await loadAuthors(rows.map((r) => r.author_id));
    // The window grows by one page, up to the hard ceiling, so what was just
    // loaded is not trimmed right back out.
    capRef.current = Math.min(capRef.current + PAGE_SIZE, MAX_LOADED_HISTORY);
    commit(capMessages(mergeMessages(listRef.current, toMessages(rows)), capRef.current));
    setHasMore(rows.length === PAGE_SIZE && capRef.current < MAX_LOADED_HISTORY);
    setLoadingOlder(false);
  }, [client, hasSession, channelId, loadingOlder, hasMore, loadAuthors, toMessages, commit]);

  const send = useCallback(
    async (raw: string): Promise<SendResult> => {
      if (!client || !session || !channelId) return { ok: false, error: blocker ?? "Entra con tu wallet para continuar." };
      const content = cleanMessage(raw);
      if (!content) return { ok: false, error: "El mensaje debe tener entre 1 y 2000 caracteres." };
      const { data, error: err } = await client
        .from("messages")
        .insert({ channel_id: channelId, author_id: session.profileId, content })
        .select(MESSAGE_COLUMNS)
        .single();
      if (err) {
        return {
          ok: false,
          error:
            quotaMessage(err) ??
            "No se pudo enviar el mensaje. Revisa que seas miembro y que el canal acepte mensajes.",
        };
      }
      const row = data as unknown as MessageRow;
      await loadAuthors([row.author_id]);
      const message = toMessages([row]);
      if (message.length > 0) {
        // The realtime echo of this same row is dropped by the id-based merge.
        commit(capMessages(mergeMessages(listRef.current, message), capRef.current));
      }
      return { ok: true };
    },
    [client, session, channelId, blocker, loadAuthors, toMessages, commit],
  );

  return { messages, loading, loadingOlder, hasMore, error, blocker, send, loadOlder };
}
