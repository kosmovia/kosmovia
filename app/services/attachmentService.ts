import { MAX_ATTACHMENT_BYTES, sanitizeFileName, sniffFile } from '../lib/core/attachments-rules.ts';

/**
 * Archivos adjuntos de los mensajes (imágenes y PDF). El chat guarda en el mensaje un marcador
 * `[ARCHIVO:<id>]` por archivo; esta interfaz sube el archivo, y después pide sus datos para dibujarlo.
 * - api: sube a /api/attachments (el servidor revisa los bytes, recodifica las imágenes y pone los permisos).
 * - mock: demo en este navegador (localStorage), con imágenes reducidas y PDF de hasta 200 KB.
 */

export type AttachmentTarget = { scope: 'channel' | 'dm'; id: string };

export interface AttachmentInfo {
  id: string;
  kind: 'image' | 'pdf';
  name: string;
  /** Bytes guardados. */
  size: number;
  width?: number;
  height?: number;
  /** Miniatura para el <img> del chat (imágenes). */
  thumbUrl?: string;
  /** La imagen grande, o el PDF para descargar. */
  url: string;
}

export interface UploadOptions {
  /** 0..1 mientras se sube. */
  onProgress?: (fraction: number) => void;
  /** Para cancelar si la persona quita el archivo de la bandeja. */
  signal?: AbortSignal;
}

export interface IAttachmentService {
  /** Sube un archivo para ese canal o conversación. Falla con un mensaje en español. */
  upload(target: AttachmentTarget, file: File, options?: UploadOptions): Promise<AttachmentInfo>;
  /** Los datos de los archivos que se pueden ver (los demás no salen). */
  describe(ids: string[]): Promise<AttachmentInfo[]>;
  /** Quita un archivo que todavía no se envió. */
  discard(id: string): Promise<void>;
}

export class AttachmentError extends Error {}

/**
 * Revisión rápida en el navegador, solo para avisar antes de subir: tamaño y bytes mágicos.
 * El servidor repite todo; esto no es una defensa.
 */
export async function checkFileInBrowser(file: File): Promise<void> {
  if (file.size === 0) throw new AttachmentError('El archivo está vacío.');
  if (file.size > MAX_ATTACHMENT_BYTES) throw new AttachmentError('El archivo pesa más de 5 MB.');
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!sniffFile(head)) throw new AttachmentError('Solo imágenes (PNG, JPEG, WEBP o GIF) o PDF.');
}

// ------------------------------------------------------------------ demo

const STORAGE_KEY = 'kosmovia_attachments';
const DEMO_IMAGE_SIDE = 640;
const DEMO_THUMB_SIDE = 240;
const DEMO_PDF_MAX = 200 * 1024;

type Stored = AttachmentInfo;

function readAll(): Record<string, Stored> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Stored>) : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, Stored>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    throw new AttachmentError('No hay espacio en la demo para guardar este archivo. Prueba con uno más chico.');
  }
}

async function shrink(file: Blob, maxSide: number): Promise<{ dataUrl: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new AttachmentError('Tu navegador no pudo preparar la imagen.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  let dataUrl = canvas.toDataURL('image/webp', 0.72);
  if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/jpeg', 0.72);
  return { dataUrl, width, height };
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new AttachmentError('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

/** Demo: los archivos quedan en este navegador como data URLs chicas. Nadie más los ve. */
export class MockAttachmentService implements IAttachmentService {
  async upload(_target: AttachmentTarget, file: File, options: UploadOptions = {}): Promise<AttachmentInfo> {
    await checkFileInBrowser(file);
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const kind = sniffFile(head)?.kind === 'pdf' ? 'pdf' : 'image';
    const id = crypto.randomUUID();
    let info: Stored;
    if (kind === 'pdf') {
      if (file.size > DEMO_PDF_MAX) throw new AttachmentError('En la demo los PDF pueden pesar hasta 200 KB.');
      info = { id, kind, name: sanitizeFileName(file.name, 'documento.pdf'), size: file.size, url: await readAsDataUrl(file) };
    } else {
      let big;
      let small;
      try {
        big = await shrink(file, DEMO_IMAGE_SIDE);
        small = await shrink(file, DEMO_THUMB_SIDE);
      } catch (err) {
        if (err instanceof AttachmentError) throw err;
        throw new AttachmentError('No se pudo leer la imagen. Prueba con otra.');
      }
      info = {
        id,
        kind,
        name: sanitizeFileName(file.name, 'imagen'),
        size: Math.round((big.dataUrl.length * 3) / 4),
        width: big.width,
        height: big.height,
        url: big.dataUrl,
        thumbUrl: small.dataUrl,
      };
    }
    options.onProgress?.(1);
    const all = readAll();
    all[id] = info;
    writeAll(all);
    return info;
  }

  async describe(ids: string[]): Promise<AttachmentInfo[]> {
    const all = readAll();
    return ids.map((id) => all[id]).filter((a): a is Stored => Boolean(a));
  }

  async discard(id: string): Promise<void> {
    const all = readAll();
    if (!(id in all)) return;
    delete all[id];
    writeAll(all);
  }
}
