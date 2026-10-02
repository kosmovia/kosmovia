"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Message, User } from "../types/index.ts";
import {
  mapMessage,
  mapProfile,
  mergeMessages,
  type MessageRow,
  type ProfileRow,
} from "../lib/mappers.ts";
import { cleanMessage } from "../lib/validation.ts";
import { useSupabase } from "./useSupabase.ts";

export const PAGE_SIZE = 50;

type MessageWithAuthor = MessageRow & { author: ProfileRow | null };
export type SendResult = { ok: true } | { ok: false; error: string };

/** Last 50 messages of a channel, live inserts via Realtime, and sending. */
export function useMessages(channelId: string | null) {
  const { client, session, blocker } = useSupabase();
  const hasSession = session !== null;
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authors = useRef(new Map<string, User>());

  const authorFor = useCallback(
    async (id: string): Promise<User | null> => {
      const cached = authors.current.get(id);
      if (cached) return cached;
      if (!client) return null;
      const { data } = await client.from("profiles").select("*").eq("id", id).maybeSingle();
      if (!data) return null;
      const user = mapProfile(data as ProfileRow);
      authors.current.set(id, user);
      return user;
    },
    [client],
  );

  useEffect(() => {
    setMessages([]);
    setError(null);
    if (!client || !hasSession || !channelId) return;
    let cancelled = false;

    const toMessage = (row: MessageWithAuthor): Message | null => {
      if (!row.author) return null;
      const user = mapProfile(row.author);
      authors.current.set(user.id, user);
      return mapMessage(row, user);
    };

    (async () => {
      setLoading(true);
      const { data, error: err } = await client
        .from("messages")
        .select("*, author:profiles(*)")
        .eq("channel_id", channelId)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (cancelled) return;
      if (err) setError("No se pudieron cargar los mensajes.");
      else {
        const loaded = ((data ?? []) as unknown as MessageWithAuthor[])
          .map(toMessage)
          .filter((m): m is Message => m !== null);
        setMessages((prev) => mergeMessages(prev, loaded));
      }
      setLoading(false);
    })();

    const channel = client
      .channel(`messages:${channelId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `channel_id=eq.${channelId}` },
        async (payload) => {
          const row = payload.new as MessageRow;
          const author = await authorFor(row.author_id);
          if (cancelled || !author) return;
          setMessages((prev) => mergeMessages(prev, [mapMessage(row, author)]));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void client.removeChannel(channel);
    };
  }, [client, hasSession, channelId, authorFor]);

  const send = useCallback(
    async (raw: string): Promise<SendResult> => {
      if (!client || !session || !channelId) return { ok: false, error: blocker ?? "Entra con tu wallet para continuar." };
      const content = cleanMessage(raw);
      if (!content) return { ok: false, error: "El mensaje debe tener entre 1 y 2000 caracteres." };
      const { data, error: err } = await client
        .from("messages")
        .insert({ channel_id: channelId, author_id: session.profileId, content })
        .select("*, author:profiles(*)")
        .single();
      if (err) {
        return { ok: false, error: "No se pudo enviar el mensaje. Revisa que seas miembro y que el canal acepte mensajes." };
      }
      const message = toMessageOrNull(data as unknown as MessageWithAuthor);
      if (message) {
        authors.current.set(message.author.id, message.author);
        // The realtime echo of this same row is dropped by the id-based merge.
        setMessages((prev) => mergeMessages(prev, [message]));
      }
      return { ok: true };
    },
    [client, session, channelId, blocker],
  );

  return { messages, loading, error, blocker, send };
}

function toMessageOrNull(row: MessageWithAuthor): Message | null {
  return row.author ? mapMessage(row, mapProfile(row.author)) : null;
}
