/**
 * La solicitud de PIN que está abierta en pantalla, de una en una. Cada
 * solicitud tiene su propio id y solo ella puede resolver su promesa: la
 * respuesta tardía de una solicitud cancelada o reemplazada se ignora, así nunca
 * paga a un destino que ya no es el que la persona está viendo. Sin React, para
 * poder probarla.
 */

export interface Slot<Req, Result> {
  id: number;
  req: Req;
  resolve: (result: Result | null) => void;
}

export interface ApprovalSlot<Req, Result> {
  /** Abre una solicitud nueva; la que estuviera abierta se cancela (resuelve null). */
  open(req: Req, resolve: (result: Result | null) => void): Slot<Req, Result>;
  /** Resuelve SOLO la solicitud `id`. false si ya no es la activa (cancelada o reemplazada): no hace nada. */
  finish(id: number, result: Result | null): boolean;
  isActive(id: number): boolean;
  current(): Slot<Req, Result> | null;
}

export function createApprovalSlot<Req, Result>(): ApprovalSlot<Req, Result> {
  let seq = 0;
  let active: Slot<Req, Result> | null = null;
  return {
    open(req, resolve) {
      active?.resolve(null);
      const next: Slot<Req, Result> = { id: ++seq, req, resolve };
      active = next;
      return next;
    },
    finish(id, result) {
      if (!active || active.id !== id) return false;
      const done = active;
      active = null;
      done.resolve(result);
      return true;
    },
    isActive: (id) => active?.id === id,
    current: () => active,
  };
}
