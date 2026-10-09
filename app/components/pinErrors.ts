import { SecurityError } from '../services/securityService';

export function fmtAmount(n: number): string {
  return n.toLocaleString('es', { maximumFractionDigits: 7 });
}

/** Cuenta regresiva legible: "4 min 05 s". */
export function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const nb = String.fromCharCode(160);
  return m > 0 ? `${m}${nb}min ${String(s).padStart(2, '0')}${nb}s` : `${s}${nb}s`;
}

/** Fecha y hora legibles para el aviso de un cambio de PIN pendiente: "10 oct, 14:05". */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Mensaje en español para los errores de PIN que no necesitan un paso propio. */
export function pinErrorText(err: unknown, fallback: string): string {
  if (err instanceof SecurityError) {
    switch (err.code) {
      case 'wrong_pin': {
        const n = err.extra.attemptsLeft;
        if (n === undefined) return 'PIN incorrecto.';
        return `PIN incorrecto. Te ${n === 1 ? 'queda 1 intento' : `quedan ${n} intentos`}.`;
      }
      case 'weak_pin':
        return 'Ese PIN es muy fácil de adivinar. Evita repetidos o secuencias como 000000 o 123456.';
      case 'invalid_pin':
        return 'El PIN debe tener exactamente 6 dígitos.';
      case 'pin_exists':
        return 'Ya tienes un PIN. Para cambiarlo, ingresa el actual.';
      case 'reset_pending':
        return err.extra.pendingPinAt
          ? `Ya hay un cambio de PIN pendiente; se activa el ${fmtDateTime(err.extra.pendingPinAt)}. Si no fuiste tú, cancélalo con tu PIN actual.`
          : 'Ya hay un cambio de PIN pendiente.';
      case 'pin_changed':
        return 'Tu PIN cambió mientras tanto. Vuelve a intentarlo con el PIN actual.';
      case 'reauth_required':
        return 'Por seguridad, cierra sesión y vuelve a entrar. Luego podrás crear un PIN nuevo.';
      case 'no_pin':
        return 'Todavía no creaste tu PIN.';
      case 'locked':
        return 'Demasiados intentos. Espera un momento y vuelve a intentar.';
      default:
        return err.message || fallback;
    }
  }
  return fallback;
}
