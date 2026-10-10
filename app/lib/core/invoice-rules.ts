import { canViewChannel, roleOf, type ChannelVisibility } from "./authz.ts";

/**
 * Cobros B2B (`[COBRO_B2B:{...}]` como contenido de un mensaje): reglas puras de
 * quién puede pagar cuál.
 *
 * El cobro no es una tabla: vive dentro del texto del mensaje, así que su id es
 * el id del mensaje. Lo que decide acá es QUIÉN puede pagarlo; que se pague una
 * sola vez lo garantiza el índice único `payments_invoice_message_key`
 * (migración 0018), no este módulo: dos pagos a la vez solo los separa la base.
 */

export const PREFIX = "[COBRO_B2B:";

export interface Invoice {
  amount: number;
  concept: string;
  /** Perfil al que va dirigido el cobro; null = lo puede pagar cualquier miembro. */
  payerId: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lee el cobro del contenido de un mensaje. `null` si no es un cobro o si el
 * JSON no tiene la forma esperada: un contenido inventado nunca pasa por válido.
 */
export function parseInvoice(content: string): Invoice | null {
  if (!content.startsWith(PREFIX)) return null;
  const end = content.lastIndexOf("]");
  if (end <= PREFIX.length) return null;
  let parsed: unknown;
  try {
    // El concepto puede traer corchetes: el JSON va hasta el ÚLTIMO ']'.
    parsed = JSON.parse(content.slice(PREFIX.length, end));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { amount, concept, payerId } = parsed as { amount?: unknown; concept?: unknown; payerId?: unknown };
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return null;
  if (typeof concept !== "string") return null;
  return {
    amount,
    concept,
    payerId: typeof payerId === "string" && UUID_RE.test(payerId) ? payerId : null,
  };
}

export interface PayContext {
  /** Contenido del mensaje que dice ser un cobro. */
  content: string;
  /** Autor del cobro. */
  authorId: string;
  /** Quién intenta pagar. */
  payerId: string;
  /** Rol del pagador en la comunidad del canal (null si no es miembro). */
  role: string | null;
  visibility: ChannelVisibility;
  /** Si ya hay un pago ligado a este cobro. */
  alreadyPaid: boolean;
}

/**
 * Como `Decision` de authz, pero admite 404 y 409: "no existe" y "ya pagado" son
 * estados, no permisos faltantes. No ensancho el tipo compartido de authz por un
 * caso de este módulo.
 */
export type PayDecision =
  | { allowed: true }
  | { allowed: false; status: 400 | 401 | 403 | 404 | 409; code: string; error: string };

const ok: PayDecision = { allowed: true };

/**
 * Si `payerId` puede pagar este cobro. El orden de los motivos va de lo más
 * general a lo más específico, para que el mensaje de error sea el útil.
 */
export function canPayInvoice(ctx: PayContext): PayDecision {
  const invoice = parseInvoice(ctx.content);
  if (!invoice) {
    return { allowed: false, status: 400, code: "not_an_invoice", error: "Ese mensaje no es un cobro." };
  }

  const role = roleOf(ctx.role);
  const view = canViewChannel(role, ctx.visibility);
  if (!view.allowed) return view;

  if (ctx.alreadyPaid) {
    return { allowed: false, status: 409, code: "invoice_paid", error: "Ese cobro ya fue pagado." };
  }
  if (ctx.authorId === ctx.payerId) {
    return { allowed: false, status: 403, code: "own_invoice", error: "No puedes pagar tu propio cobro." };
  }
  if (invoice.payerId !== null && invoice.payerId !== ctx.payerId) {
    return {
      allowed: false,
      status: 403,
      code: "not_the_payer",
      error: "Ese cobro está dirigido a otra persona.",
    };
  }
  return ok;
}
