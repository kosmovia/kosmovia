/**
 * Adapter "api" de los archivos adjuntos: habla con /api/attachments.
 * La subida usa XMLHttpRequest (y no fetch) para poder mostrar la barra de progreso.
 */
import { apiRequest } from '../../lib/core/api-client.ts';
import { tokenStore } from '../../lib/core/token-store.ts';
import {
  AttachmentError,
  checkFileInBrowser,
  type AttachmentInfo,
  type AttachmentTarget,
  type IAttachmentService,
  type UploadOptions,
} from '../attachmentService';

type Wire = { id: string; kind: 'image' | 'pdf'; name: string; size: number; width: number | null; height: number | null };

const NETWORK_ERROR = 'No se pudo conectar con el servidor. Revisa tu conexión.';
const CHUNK = 40;

function toInfo(w: Wire): AttachmentInfo {
  return {
    id: w.id,
    kind: w.kind,
    name: w.name,
    size: w.size,
    width: w.width ?? undefined,
    height: w.height ?? undefined,
    url: `/api/attachments/${encodeURIComponent(w.id)}`,
    thumbUrl: w.kind === 'image' ? `/api/attachments/${encodeURIComponent(w.id)}/thumb` : undefined,
  };
}

function send(url: string, file: File, options: UploadOptions): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.responseType = 'text';
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Attachment-Name', encodeURIComponent(file.name.slice(0, 200)));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) options.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        /* respuesta sin JSON */
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new AttachmentError(NETWORK_ERROR));
    xhr.onabort = () => reject(new DOMException('Subida cancelada', 'AbortError'));
    if (options.signal) {
      if (options.signal.aborted) {
        reject(new DOMException('Subida cancelada', 'AbortError'));
        return;
      }
      options.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });
}

export class ApiAttachmentService implements IAttachmentService {
  async upload(target: AttachmentTarget, file: File, options: UploadOptions = {}): Promise<AttachmentInfo> {
    await checkFileInBrowser(file);
    const url = `/api/attachments?scope=${target.scope}&id=${encodeURIComponent(target.id)}`;
    // Igual que apiRequest: si la sesión está por vencer se renueva antes, y un 401 se reintenta una vez.
    await tokenStore.getToken();
    let res = await send(url, file, options);
    if (res.status === 401 && tokenStore.get()) {
      const before = tokenStore.get();
      const after = await tokenStore.refreshNow();
      if (after && after !== before) res = await send(url, file, options);
    }
    if (res.status !== 201) {
      throw new AttachmentError(typeof res.body.error === 'string' ? res.body.error : 'No se pudo subir el archivo. Intenta de nuevo.');
    }
    return toInfo(res.body as unknown as Wire);
  }

  async describe(ids: string[]): Promise<AttachmentInfo[]> {
    const unique = Array.from(new Set(ids));
    const out: AttachmentInfo[] = [];
    for (let i = 0; i < unique.length; i += CHUNK) {
      const res = await apiRequest<{ attachments: Wire[] }>(`/api/attachments?ids=${unique.slice(i, i + CHUNK).join(',')}`);
      // Un error se propaga: el chat reintenta, y no marca el archivo como inexistente.
      if (!res.ok) throw new AttachmentError(res.error);
      out.push(...res.data.attachments.map(toInfo));
    }
    return out;
  }

  async discard(id: string): Promise<void> {
    await apiRequest(`/api/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}
