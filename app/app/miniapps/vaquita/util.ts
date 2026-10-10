import type { Vaquita } from '@/services';

/** Monto para mostrar: hasta 7 decimales sin ceros de sobra, sin separador de miles. */
export function fmtUsdc(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 7, useGrouping: false });
}

export function timeAgo(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

export function isExpired(v: Vaquita, now = Date.now()): boolean {
  return v.deadline !== null && new Date(v.deadline).getTime() <= now;
}

/** Abierta de verdad: no cerrada y sin la fecha vencida. */
export function isActive(v: Vaquita, now = Date.now()): boolean {
  return v.status === 'open' && !isExpired(v, now);
}

export function deadlineText(v: Vaquita, now = Date.now()): string {
  if (v.status === 'closed') return 'Cerrada';
  if (!v.deadline) return 'Sin fecha límite';
  const end = new Date(v.deadline);
  if (end.getTime() <= now) return 'Venció';
  const today = new Date(now);
  const days = Math.round(
    (new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000,
  );
  if (days <= 0) return 'Vence hoy';
  if (days === 1) return 'Vence mañana';
  return `Vence en ${days} días`;
}

export function percent(v: Vaquita): number {
  if (v.goalUsdc <= 0) return 0;
  return Math.min(100, Math.round((v.raisedUsdc / v.goalUsdc) * 100));
}

/** Convierte lo que escribió la persona ("0,5" o "0.05") en número, o null si no es válido. */
export function parseAmount(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,7})?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function initial(name: string): string {
  return (name.replace(/^@/, '').trim()[0] ?? '?').toUpperCase();
}

export function contributorsText(n: number): string {
  if (n === 0) return 'Sin aportes todavía';
  return n === 1 ? '1 persona aportó' : `${n} personas aportaron`;
}

export function toYmd(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
