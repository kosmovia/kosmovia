'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatBytes } from '../lib/core/attachments-rules.ts';
import type { AttachmentInfo } from '../services';
import { retryAttachment, useAttachmentInfos } from './attachment-cache';
import { IconClose } from './Icons';
import type { TrayItem } from './useComposerAttachments';

/** Archivos adjuntos en pantalla: la bandeja del compositor, lo que se ve en los mensajes y el visor de imágenes. */

const THUMB_MAX_W = 360;
const THUMB_MAX_H = 320;

function IconPdf({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

function IconDownload({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
    </svg>
  );
}

/** Tamaño de la miniatura en el chat: cabe en 360 x 320 sin deformarse. Sin medidas, un rectángulo 4:3. */
function thumbBox(info: AttachmentInfo): { width: number; ratio: string } {
  const w = info.width && info.width > 0 ? info.width : 4;
  const h = info.height && info.height > 0 ? info.height : 3;
  const scale = Math.min(1, THUMB_MAX_W / w, THUMB_MAX_H / h);
  const width = info.width && info.height ? Math.max(48, Math.round(w * scale)) : 240;
  return { width, ratio: `${w} / ${h}` };
}

// ---------------------------------------------------------------- en los mensajes

/** Las imágenes y los PDF de un mensaje (uno por marcador `[ARCHIVO:<id>]`). */
export function MessageAttachments({ ids }: { ids: string[] }) {
  const infos = useAttachmentInfos(ids);
  const [viewing, setViewing] = useState<AttachmentInfo | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const close = () => {
    setViewing(null);
    // El foco vuelve a la miniatura que se tocó.
    setTimeout(() => opener.current?.focus(), 0);
  };

  return (
    <div className="kv-att-list">
      {ids.map((id, index) => {
        const info = infos[index];
        if (info === undefined) return <div key={id} className="kv-att-skeleton" aria-hidden="true" />;
        if (info === 'error') return <button key={id} type="button" className="kv-att-missing" onClick={() => retryAttachment(id)}>No se pudo cargar el archivo · Reintentar</button>;
        if (info === 'missing') {
          return (
            <div key={id} className="kv-att-missing" role="note">
              Archivo no disponible
            </div>
          );
        }
        if (info.kind === 'pdf') return <PdfCard key={id} info={info} />;
        const box = thumbBox(info);
        return (
          <button
            key={id}
            type="button"
            className="kv-att-img"
            style={{ width: box.width, aspectRatio: box.ratio }}
            onClick={(e) => {
              opener.current = e.currentTarget;
              setViewing(info);
            }}
            aria-label={`Ver imagen ${info.name}`}
            title={info.name}
          >
            <img src={info.thumbUrl ?? info.url} alt={info.name} loading="lazy" decoding="async" draggable={false} />
          </button>
        );
      })}
      {viewing ? <ImageViewer info={viewing} onClose={close} /> : null}
    </div>
  );
}

function PdfCard({ info }: { info: AttachmentInfo }) {
  return (
    <div className="kv-att-pdf">
      <span className="kv-att-pdf-icon">
        <IconPdf />
      </span>
      <span className="kv-att-pdf-text">
        <span className="kv-att-pdf-name" title={info.name}>
          {info.name}
        </span>
        <span className="kv-att-pdf-meta">PDF · {formatBytes(info.size)}</span>
      </span>
      <a className="kv-att-download" href={info.url} download={info.name} rel="noopener" aria-label={`Descargar ${info.name}`}>
        <IconDownload /> Descargar
      </a>
    </div>
  );
}

/** Visor simple: la imagen grande sobre fondo oscuro. Escape, el fondo o la X lo cierran. */
function ImageViewer({ info, onClose }: { info: AttachmentInfo; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // El chat se vuelve a dibujar cada pocos segundos: el cierre va por una ref para no repetir el foco ni los listeners.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const dialog = closeRef.current?.closest('[role="dialog"]');
        const buttons = Array.from(dialog?.querySelectorAll<HTMLElement>('a[href], button') ?? []);
        const first = buttons[0]; const last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', onKey); };
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="kv-att-viewer" role="dialog" aria-modal="true" aria-label={`Imagen ${info.name}`} onClick={onClose}>
      <div className="kv-att-viewer-bar" onClick={(e) => e.stopPropagation()}>
        <span className="kv-att-viewer-name" title={info.name}>
          {info.name}
        </span>
        <a className="kv-att-download" href={info.url} download={info.name} rel="noopener">
          <IconDownload /> Descargar
        </a>
        <button ref={closeRef} type="button" className="kv-att-viewer-close" onClick={onClose} aria-label="Cerrar imagen">
          <IconClose size={20} />
        </button>
      </div>
      <img className="kv-att-viewer-img" src={info.url} alt={info.name} onClick={(e) => e.stopPropagation()} />
    </div>,
    document.body,
  );
}

// -------------------------------------------------------------- en el compositor

/** La bandeja con lo que se va a enviar: miniatura o ícono PDF, nombre, tamaño o progreso y la X para quitarlo. */
export function ComposerTray({
  items,
  error,
  onRemove,
}: {
  items: TrayItem[];
  error: string | null;
  onRemove: (key: string) => void;
}) {
  if (items.length === 0 && !error) return null;
  return (
    <div className="kv-att-tray-wrap">
      {error ? (
        <p className="kv-att-error" role="alert">
          {error}
        </p>
      ) : null}
      {items.length > 0 ? (
        <ul className="kv-att-tray" aria-label="Archivos para enviar">
          {items.map((item) => {
            const uploading = item.status === 'uploading';
            const percent = Math.round(item.progress * 100);
            return (
              <li key={item.key} className="kv-att-chip" aria-busy={uploading}>
                <span className="kv-att-chip-thumb">
                  {item.kind === 'image' && (item.previewUrl || item.info?.thumbUrl) ? (
                    <img src={item.previewUrl ?? item.info?.thumbUrl} alt="" draggable={false} />
                  ) : (
                    <IconPdf size={20} />
                  )}
                </span>
                <span className="kv-att-chip-text">
                  <span className="kv-att-chip-name" title={item.name}>
                    {item.name}
                  </span>
                  <span className="kv-att-chip-meta" role={uploading ? 'status' : undefined}>
                    {uploading ? `Subiendo… ${percent}%` : formatBytes(item.info?.size ?? item.size)}
                  </span>
                  {uploading ? (
                    <span
                      className="kv-att-progress"
                      role="progressbar"
                      aria-label={`Subiendo ${item.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                    >
                      <span style={{ width: `${percent}%` }} />
                    </span>
                  ) : null}
                </span>
                <button type="button" className="kv-att-chip-remove" onClick={() => onRemove(item.key)} aria-label={`Quitar ${item.name}`} title="Quitar">
                  <IconClose size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
