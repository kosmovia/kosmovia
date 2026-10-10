'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { attachmentService, type AttachmentInfo } from '../services';

/**
 * Memoria de los datos de archivos adjuntos (nombre, tamaño, miniatura) por id. Los datos de un archivo no
 * cambian nunca, así que se piden una sola vez; los pedidos de varios mensajes se juntan en una sola consulta.
 * 'missing' = el servidor no lo muestra (se borró o la persona no tiene permiso).
 */

type Entry = AttachmentInfo | 'missing' | 'error';

const cache = new Map<string, Entry>();
const inflight = new Set<string>();
const queue = new Set<string>();
const attempts = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const MAX_ATTEMPTS = 3;
const RETRY_MS = 4000;

function emit() {
  version += 1;
  listeners.forEach((fn) => fn());
}

/** Un archivo recién subido: ya se conoce, no hace falta preguntarle al servidor. */
export function rememberAttachment(info: AttachmentInfo): void {
  cache.set(info.id, info);
  emit();
}

async function flush(): Promise<void> {
  const started = generation;
  timer = null;
  const ids = Array.from(queue);
  queue.clear();
  if (ids.length === 0) return;
  ids.forEach((id) => inflight.add(id));
  try {
    const found = await attachmentService.describe(ids);
    if (started !== generation) return;
    const seen = new Set<string>();
    for (const info of found) {
      cache.set(info.id, info);
      seen.add(info.id);
    }
    for (const id of ids) if (!seen.has(id)) cache.set(id, 'missing');
  } catch {
    if (started !== generation) return;
    // Sin conexión o límite de consultas: se reintenta un par de veces, sin marcarlos como inexistentes.
    for (const id of ids) {
      const n = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, n);
      if (n < MAX_ATTEMPTS) setTimeout(() => { if (started === generation) want([id]); }, RETRY_MS);
      else cache.set(id, 'error');
    }
  } finally {
    if (started !== generation) return;
    ids.forEach((id) => inflight.delete(id));
    emit();
  }
}

function want(ids: string[]): void {
  for (const id of ids) if (!cache.has(id) && !inflight.has(id)) queue.add(id);
  if (queue.size > 0 && timer === null) timer = setTimeout(() => void flush(), 20);
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** Los datos de esos ids, en el mismo orden: undefined = cargando. */
export function useAttachmentInfos(ids: string[]): Array<Entry | undefined> {
  const revision = useSyncExternalStore(subscribe, () => version, () => 0);
  const key = ids.join(',');
  useEffect(() => {
    want(key ? key.split(',') : []);
  }, [key, revision]);
  return ids.map((id) => cache.get(id));
}

/** Reset permissions and failed requests when the signed-in user changes. */
export function resetAttachmentCache(): void {
  generation += 1;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  cache.clear(); inflight.clear(); queue.clear(); attempts.clear();
  emit();
}

export function retryAttachment(id: string): void {
  cache.delete(id); attempts.delete(id);
  want([id]); emit();
}
