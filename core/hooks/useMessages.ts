"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Message, User } from "../types/index.ts";
import { apiRequest } from "../lib/api-client.ts";
import { isApiBackend } from "../lib/backend.ts";
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

/** api backend: how often the open tab asks for new messages. */
export const POLL_INTERVAL_MS = 2_500;
/** After a failed poll the wait grows up to this, and snaps back on success. */
const POLL_MAX_BACKOFF_MS = 10_000;
/** Every this many polls the newest page is fetched instead of `after=`, a safety net for a lost cursor. */
const POLL_FULL_REFRESH_EVERY = 20;

/** What the api backend returns per message: the row plus its slim author, so no author lookups are needed. */
type WireMessage = MessageRow & { author: AuthorRow };

export type SendResult = { ok: true } | { ok: false; error: string };

/**
 * Messages of a channel: the newest page, live updates, "load older"
 * pagination, and sending.
 *
 * - supabase backend: live inserts arrive through Realtime.
 * - api backend: there is no push, so the open tab polls
 *   GET /api/channels/[id]/messages?after=<newest id> every 2.5 s while it is
 *   visible (paused when hidden, one immediate poll when it comes back).
 * - Memory is bounded: at most MAX_WINDOW (200) messages, growing by one page
 *   per "Cargar anteriores" up to MAX_LOADED_HISTORY; live inserts push the
 *   oldest out once the cap is reached.
 * - supabase: messages are fetched without any author columns, and each author
 *   profile (only id, username, display_name, avatar_seed, avatar_style) is
 *   fetched once and cached by id, in batches. api: the server joins the slim author.
 */
export function useMessages(channelId: string | null) {
  const { client, session, blocker, configured } = useSupabase();
  const api = isApiBackend();
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

  const fromWire = useCallback((rows: WireMessage[]): Message[] => {
    return rows.map((row) => mapMessage(row, mapAuthor(row.author)));
  }, []);

  useEffect(() => {
    commit([]);
    capRef.current = MAX_WINDOW;
    setHasMore(false);
    setError(null);
    if (!configured || !hasSession || !channelId) return;
    let cancelled = false;

    if (api) return startPolling();
    if (!client) return;

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

    /** api backend: first page, then poll while the tab is visible. */
    function startPolling(): () => void {
      const base = `/api/channels/${encodeURIComponent(channelId as string)}/messages`;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let loaded = false;
      let polling = false;
      let failures = 0;
      let polls = 0;

      const schedule = (delay: number) => {
        clearTimeout(timer);
        if (cancelled || document.hidden) return;
        timer = setTimeout(() => void tick(), delay);
      };

      /** Merges rows we don't have yet. Quiet when there is nothing new, so an idle channel doesn't re-render. */
      const absorb = (rows: WireMessage[]) => {
        const known = new Set(listRef.current.map((m) => m.id));
        const fresh = fromWire(rows).filter((m) => !known.has(m.id));
        if (fresh.length === 0) return;
        const merged = mergeMessages(listRef.current, fresh);
        const capped = capMessages(merged, capRef.current);
        if (capped.length < merged.length) setHasMore(true);
        commit(capped);
      };

      const pollOnce = async (): Promise<boolean> => {
        polls += 1;
        const newest = listRef.current[listRef.current.length - 1];
        const query =
          newest && polls % POLL_FULL_REFRESH_EVERY !== 0
            ? `after=${encodeURIComponent(newest.id)}&limit=100`
            : `limit=${PAGE_SIZE}`;
        const res = await apiRequest<{ messages: WireMessage[] }>(`${base}?${query}`);
        if (cancelled) return true;
        if (!res.ok) {
          // Not a member (any more) or the channel is gone: retrying won't fix it.
          if (res.status === 403 || res.status === 404) setError(res.error);
          return false;
        }
        absorb(res.data.messages);
        return true;
      };

      const tick = async () => {
        if (cancelled || polling || !loaded) return;
        polling = true;
        const ok = await pollOnce();
        polling = false;
        failures = ok ? 0 : failures + 1;
        schedule(Math.min(POLL_INTERVAL_MS * 2 ** Math.min(failures, 3), POLL_MAX_BACKOFF_MS));
      };

      const onVisibility = () => {
        clearTimeout(timer);
        if (!document.hidden && loaded) void tick();
      };
      document.addEventListener("visibilitychange", onVisibility);

      (async () => {
        setLoading(true);
        const res = await apiRequest<{ messages: WireMessage[] }>(`${base}?limit=${PAGE_SIZE}`);
        if (cancelled) return;
        if (!res.ok) {
          setError(res.status === 403 ? res.error : "No se pudieron cargar los mensajes.");
          setLoading(false);
          return;
        }
        commit(capMessages(mergeMessages(listRef.current, fromWire(res.data.messages)), capRef.current));
        setHasMore(res.data.messages.length === PAGE_SIZE);
        setLoading(false);
        loaded = true;
        schedule(POLL_INTERVAL_MS);
      })();

      return () => {
        cancelled = true;
        clearTimeout(timer);
        document.removeEventListener("visibilitychange", onVisibility);
      };
    }
  }, [api, configured, client, hasSession, channelId, loadAuthors, toMessages, fromWire, commit]);

  const loadOlder = useCallback(async (): Promise<void> => {
    if (!configured || !hasSession || !channelId || loadingOlder || !hasMore) return;
    const oldest = listRef.current[0];
    if (!oldest) return;

    if (api) {
      setLoadingOlder(true);
      const res = await apiRequest<{ messages: WireMessage[] }>(
        `/api/channels/${encodeURIComponent(channelId)}/messages?before=${encodeURIComponent(oldest.id)}&limit=${PAGE_SIZE}`,
      );
      if (!res.ok) {
        setError("No se pudieron cargar los mensajes anteriores.");
        setLoadingOlder(false);
        return;
      }
      capRef.current = Math.min(capRef.current + PAGE_SIZE, MAX_LOADED_HISTORY);
      commit(capMessages(mergeMessages(listRef.current, fromWire(res.data.messages)), capRef.current));
      setHasMore(res.data.messages.length === PAGE_SIZE && capRef.current < MAX_LOADED_HISTORY);
      setLoadingOlder(false);
      return;
    }

    if (!client) return;
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
  }, [api, configured, client, hasSession, channelId, loadingOlder, hasMore, loadAuthors, toMessages, fromWire, commit]);

  const send = useCallback(
    async (raw: string): Promise<SendResult> => {
      if (!configured || !session || !channelId) return { ok: false, error: blocker ?? "Entra con tu wallet para continuar." };
      const content = cleanMessage(raw);
      if (!content) return { ok: false, error: "El mensaje debe tener entre 1 y 2000 caracteres." };

      if (api) {
        // The author is the session's profile: the server ignores anything else.
        const res = await apiRequest<{ message: WireMessage }>(
          `/api/channels/${encodeURIComponent(channelId)}/messages`,
          { method: "POST", body: { content } },
        );
        if (!res.ok) return { ok: false, error: res.error };
        // The next poll returns this same row again: the id-based merge drops it.
        commit(capMessages(mergeMessages(listRef.current, fromWire([res.data.message])), capRef.current));
        return { ok: true };
      }

      if (!client) return { ok: false, error: blocker ?? "Entra con tu wallet para continuar." };
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
    [api, configured, client, session, channelId, blocker, loadAuthors, toMessages, fromWire, commit],
  );

  return { messages, loading, loadingOlder, hasMore, error, blocker, send, loadOlder };
}
