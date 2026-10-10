'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_ATTACHMENTS_PER_MESSAGE, sniffFile } from '../lib/core/attachments-rules.ts';
import { attachmentService, checkFileInBrowser, type AttachmentInfo, type AttachmentTarget } from '../services';
import { rememberAttachment } from './attachment-cache';

export interface TrayItem {
  key: string;
  name: string;
  size: number;
  kind: 'image' | 'pdf';
  previewUrl?: string;
  status: 'uploading' | 'ready';
  progress: number;
  info?: AttachmentInfo;
}

/** Uploads belong to one conversation; in-flight message files are retained until its result. */
export function useComposerAttachments(target: AttachmentTarget | undefined) {
  const [items, setItems] = useState<TrayItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const itemsRef = useRef<TrayItem[]>([]);
  const aborts = useRef(new Map<string, AbortController>());
  const reserved = useRef(new Set<string>());
  const mounted = useRef(true);
  const targetKey = target ? target.scope + ':' + target.id : '';
  const currentTarget = useRef(targetKey);
  currentTarget.current = targetKey;
  const lastTarget = useRef(targetKey);
  const commit = useCallback((next: TrayItem[]) => {
    itemsRef.current = next;
    if (mounted.current) setItems(next);
  }, []);
  const patch = useCallback((key: string, change: Partial<TrayItem>) => {
    commit(itemsRef.current.map(item => item.key === key ? { ...item, ...change } : item));
  }, [commit]);
  const drop = useCallback((key: string, discard: boolean) => {
    const item = itemsRef.current.find(i => i.key === key);
    if (!item) return;
    aborts.current.get(key)?.abort();
    aborts.current.delete(key);
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (discard && item.info && !reserved.current.has(item.info.id)) void attachmentService.discard(item.info.id).catch(() => undefined);
    commit(itemsRef.current.filter(i => i.key !== key));
  }, [commit]);
  const addFiles = useCallback(async (files: File[]) => {
    if (!target || !mounted.current) return;
    const destination = target.scope + ':' + target.id;
    setError(null);
    for (const file of files) {
      if (!mounted.current || currentTarget.current !== destination) return;
      if (itemsRef.current.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
        setError('Máximo ' + MAX_ATTACHMENTS_PER_MESSAGE + ' archivos por mensaje.');
        break;
      }
      let kind: 'image' | 'pdf';
      try {
        await checkFileInBrowser(file);
        kind = sniffFile(new Uint8Array(await file.slice(0, 16).arrayBuffer()))!.kind;
      } catch (err) {
        if (mounted.current && currentTarget.current === destination) setError(err instanceof Error ? err.message : 'No se pudo leer el archivo.');
        continue;
      }
      if (!mounted.current || currentTarget.current !== destination) return;
      // Recheck after async validation, including simultaneous paste/drop selections.
      if (itemsRef.current.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
        setError('Máximo ' + MAX_ATTACHMENTS_PER_MESSAGE + ' archivos por mensaje.');
        break;
      }
      const key = crypto.randomUUID();
      commit([...itemsRef.current, { key, name: file.name || 'archivo', size: file.size, kind,
        previewUrl: kind === 'image' ? URL.createObjectURL(file) : undefined, status: 'uploading', progress: 0 }]);
      const controller = new AbortController();
      aborts.current.set(key, controller);
      void attachmentService.upload(target, file, { signal: controller.signal, onProgress: progress => patch(key, { progress }) })
        .then(info => {
          if (!mounted.current || currentTarget.current !== destination || !itemsRef.current.some(i => i.key === key)) {
            void attachmentService.discard(info.id).catch(() => undefined);
            return;
          }
          rememberAttachment(info);
          patch(key, { status: 'ready', progress: 1, info });
        }).catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          drop(key, false);
          if (mounted.current && currentTarget.current === destination) setError(err instanceof Error ? err.message : 'No se pudo subir el archivo.');
        }).finally(() => aborts.current.delete(key));
    }
  }, [target, commit, patch, drop]);
  const remove = useCallback((key: string) => drop(key, true), [drop]);
  const reserve = useCallback((ids: string[]) => { ids.forEach(id => reserved.current.add(id)); }, []);
  const settle = useCallback((ids: string[], sent: boolean, destination: string) => {
    ids.forEach(id => reserved.current.delete(id));
    if (sent) {
      for (const item of [...itemsRef.current]) if (item.info && ids.includes(item.info.id)) drop(item.key, false);
    } else if (!mounted.current || currentTarget.current !== destination) {
      ids.forEach(id => { void attachmentService.discard(id).catch(() => undefined); });
    }
  }, [drop]);
  useEffect(() => {
    if (lastTarget.current === targetKey) return;
    lastTarget.current = targetKey;
    for (const item of [...itemsRef.current]) drop(item.key, true);
    setError(null);
  }, [targetKey, drop]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const item of [...itemsRef.current]) drop(item.key, true);
    };
  }, [drop]);
  return { items, error, setError, addFiles, remove, reserve, settle,
    readyIds: items.flatMap(i => i.status === 'ready' && i.info ? [i.info.id] : []),
    busy: items.some(i => i.status === 'uploading') };
}
