"use client";

import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { readSupabaseEnv } from "./supabase.ts";

/**
 * Supabase Realtime para el chat, con el backend "api".
 *
 * El navegador no puede leer la cookie de sesión (es httpOnly), así que pide un
 * JWT corto a /api/realtime/token y con eso abre el WebSocket. Ese token lleva
 * `sub` = id del perfil, así que las políticas RLS de la base deciden qué
 * mensajes recibe cada quien: los canales privados los protege Postgres, no el
 * cliente.
 *
 * Lo que viaja por el canal:
 *  - `postgres_changes` sobre `messages` del canal: solo avisa "algo cambió".
 *    Quien escucha vuelve a pedir la última página por /api, que es donde están
 *    la autorización y el autor de cada mensaje. Realtime reemplaza al
 *    temporizador, no a la API.
 *  - `broadcast` "typing": efímero, solo el id de quien escribe. No se guarda.
 *
 * Hay UN canal de Supabase por canal de chat, compartido entre quien escucha
 * mensajes y quien escucha el typing (contador de referencias): abrir dos
 * suscripciones al mismo nombre sería gastar conexión al doble sin ganar nada.
 */

/** Se pide un token nuevo cuando al actual le queda menos que esto. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const TYPING_EVENT = "typing";
/** Como máximo un aviso de "escribiendo" cada tanto, por más que se teclee. */
const TYPING_THROTTLE_MS = 2_000;

let client: SupabaseClient | null | undefined;
let cached: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string | null> | null = null;

async function fetchToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/realtime/token", { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { token?: unknown; expiresAt?: unknown };
    if (typeof body.token !== "string" || typeof body.expiresAt !== "number") return null;
    cached = { token: body.token, expiresAt: body.expiresAt };
    return body.token;
  } catch {
    return null;
  }
}

/** El token de Realtime, reusado hasta que le queden pocos minutos. */
async function realtimeToken(): Promise<string | null> {
  if (cached && cached.expiresAt - Date.now() > REFRESH_MARGIN_MS) return cached.token;
  inflight ??= fetchToken().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Olvida el token cacheado (al cerrar sesión, para no reusar el del perfil anterior). */
export function forgetRealtimeToken(): void {
  cached = null;
}

/**
 * Cliente de Supabase usado SOLO para Realtime: ninguna consulta de datos pasa
 * por acá (esas van por /api). Devuelve null si faltan las variables públicas,
 * y entonces quien llama se queda con el polling.
 */
function getRealtimeClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const env = readSupabaseEnv();
  if (!env.ok) {
    client = null;
    return client;
  }
  client = createClient(env.url, env.anonKey, { realtime: { params: { eventsPerSecond: 10 } } });
  return client;
}

/**
 * Le pasa el token a Realtime ANTES de suscribirse, y esto no es opcional: sin
 * esto la conexión se abre con la clave anon, Realtime guarda la suscripción con
 * `role: anon` y —como anon no tiene SELECT sobre las columnas de `messages`—
 * su validación de filtros la rechaza con "invalid column for filter
 * channel_id". El canal igual queda SUBSCRIBED, así que el síntoma es que no
 * llega ningún cambio. Verificado contra el proyecto real.
 */
async function ensureAuth(supabase: SupabaseClient): Promise<boolean> {
  const token = await realtimeToken();
  if (!token) return false;
  await supabase.realtime.setAuth(token);
  scheduleTokenRefresh(supabase);
  return true;
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;

/** Renueva el token antes de que venza, mientras quede algún canal abierto. */
function scheduleTokenRefresh(supabase: SupabaseClient): void {
  clearTimeout(refreshTimer);
  if (!cached) return;
  const wait = Math.max(cached.expiresAt - Date.now() - REFRESH_MARGIN_MS, 30_000);
  refreshTimer = setTimeout(() => {
    if (entries.size === 0) return;
    cached = null;
    void ensureAuth(supabase);
  }, wait);
}

interface Entry {
  channel: RealtimeChannel;
  refs: number;
  onChange: Set<() => void>;
  onTyping: Set<(profileId: string) => void>;
  onLive: Set<(live: boolean) => void>;
  live: boolean;
  lastTypingSent: number;
}

const entries = new Map<string, Entry>();

function openEntry(supabase: SupabaseClient, channelId: string): Entry {
  const entry: Entry = {
    channel: undefined as unknown as RealtimeChannel,
    refs: 0,
    onChange: new Set(),
    onTyping: new Set(),
    onLive: new Set(),
    live: false,
    lastTypingSent: 0,
  };

  entry.channel = supabase
    .channel(`messages:${channelId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages", filter: `channel_id=eq.${channelId}` },
      () => {
        for (const fn of entry.onChange) fn();
      },
    )
    .on("broadcast", { event: TYPING_EVENT }, (message) => {
      const id = (message.payload as { profileId?: unknown } | null)?.profileId;
      if (typeof id !== "string" || !id) return;
      for (const fn of entry.onTyping) fn(id);
    });

  entries.set(channelId, entry);

  // La suscripción espera al token: ver ensureAuth(). Si no hay token, el canal
  // no se abre y quien escucha se queda con el polling.
  void ensureAuth(supabase).then((ok) => {
    if (!entries.has(channelId)) return; // se cerró mientras llegaba el token
    if (!ok) {
      for (const fn of entry.onLive) fn(false);
      return;
    }
    entry.channel.subscribe((status) => {
      entry.live = status === "SUBSCRIBED";
      for (const fn of entry.onLive) fn(entry.live);
    });
  });

  return entry;
}

export interface ChannelLinkOptions {
  /** Algo cambió en los mensajes del canal (alta, edición o borrado). */
  onChange: () => void;
  /** Id de perfil de quien está escribiendo. Puede ser el propio: filtra quien llama. */
  onTyping?: (profileId: string) => void;
  /** true cuando la suscripción quedó viva; false si falló o se cortó. */
  onLive?: (live: boolean) => void;
}

export interface ChannelLink {
  /** Emite "estoy escribiendo". Se puede llamar por cada tecla: va limitado. */
  notifyTyping(profileId: string): void;
  close(): void;
}

/**
 * Se engancha al canal de Realtime de un canal de chat (lo abre si es el
 * primero). Devuelve null cuando Supabase no está configurado, para que quien
 * llama use el polling.
 */
export function openChannelLink(channelId: string, options: ChannelLinkOptions): ChannelLink | null {
  const supabase = getRealtimeClient();
  if (!supabase) return null;

  const entry = entries.get(channelId) ?? openEntry(supabase, channelId);
  entry.refs += 1;
  entry.onChange.add(options.onChange);
  if (options.onTyping) entry.onTyping.add(options.onTyping);
  if (options.onLive) {
    entry.onLive.add(options.onLive);
    // El canal pudo quedar vivo antes de este enganche: avisa el estado actual.
    if (entry.live) options.onLive(true);
  }

  let closed = false;
  return {
    notifyTyping(profileId: string) {
      if (closed || !profileId) return;
      sendTyping(channelId, profileId);
    },
    close() {
      if (closed) return;
      closed = true;
      entry.onChange.delete(options.onChange);
      if (options.onTyping) entry.onTyping.delete(options.onTyping);
      if (options.onLive) entry.onLive.delete(options.onLive);
      entry.refs -= 1;
      if (entry.refs <= 0) {
        entries.delete(channelId);
        void supabase.removeChannel(entry.channel);
      }
    },
  };
}

/**
 * Emite "estoy escribiendo" en un canal ya abierto. Si nadie tiene el canal
 * abierto no hace nada: no vale la pena abrir una conexión solo para esto.
 */
export function sendTyping(channelId: string, profileId: string): void {
  const entry = entries.get(channelId);
  if (!entry || !entry.live || !profileId) return;
  const now = Date.now();
  if (now - entry.lastTypingSent < TYPING_THROTTLE_MS) return;
  entry.lastTypingSent = now;
  void entry.channel.send({ type: "broadcast", event: TYPING_EVENT, payload: { profileId } });
}
