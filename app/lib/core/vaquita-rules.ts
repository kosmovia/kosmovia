import { fromStroops, toStroops } from "./payments.ts";
import type { Parsed } from "./api-input.ts";

/**
 * Vaquita (migración 0010): reglas puras. Validación del cuerpo de crear, quién
 * puede cerrar, cuándo un pago ya registrado puede vincularse como aporte y el
 * cálculo del progreso. Cada regla se aplica otra vez dentro del SQL
 * (sql.insertVaquitaContribution), así que esto es para responder con el motivo.
 */

export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 280;
export const GOAL_MIN = "0.01";
export const GOAL_MAX = "100000";
export const DEADLINE_MAX_MS = 366 * 24 * 60 * 60 * 1000;

const GOAL_RE = /^(\d{1,6})(?:\.(\d{1,7}))?$/;

export interface VaquitaCreate {
  title: string;
  description: string | null;
  /** Decimal con 7 lugares ("50.0000000"). */
  goalUsdc: string;
  /** ISO en UTC, o null si no tiene fecha límite. */
  deadline: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** El monto de la meta como llega (número o texto) -> "50.0000000", o null. */
export function parseGoal(raw: unknown): string | null {
  let text: string;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    text = String(raw);
  } else if (typeof raw === "string") {
    text = raw.trim().replace(",", ".");
  } else {
    return null;
  }
  if (!GOAL_RE.test(text)) return null;
  const stroops = toStroops(text);
  if (stroops === null) return null;
  if (stroops < (toStroops(GOAL_MIN) as bigint) || stroops > (toStroops(GOAL_MAX) as bigint)) return null;
  return fromStroops(stroops);
}

/** Cuerpo de POST /api/communities/[slug]/vaquitas. `now`: epoch ms (para probar la fecha límite). */
export function parseVaquitaCreate(body: unknown, now: number): Parsed<VaquitaCreate> {
  if (!isRecord(body)) return { ok: false, error: "Datos inválidos." };

  if (typeof body.title !== "string") return { ok: false, error: "Ponle un título a la vaquita." };
  // eslint-disable-next-line no-control-regex
  const title = body.title.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (title.length < 1) return { ok: false, error: "Ponle un título a la vaquita." };
  if (title.length > TITLE_MAX) return { ok: false, error: `El título debe tener ${TITLE_MAX} caracteres como máximo.` };

  let description: string | null = null;
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== "string") return { ok: false, error: "Revisa la descripción." };
    // Se conservan los saltos de línea; el resto de caracteres de control se quita.
    // eslint-disable-next-line no-control-regex
    const clean = body.description.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim();
    if (clean.length > DESCRIPTION_MAX) {
      return { ok: false, error: `La descripción debe tener ${DESCRIPTION_MAX} caracteres como máximo.` };
    }
    description = clean === "" ? null : clean;
  }

  const goalUsdc = parseGoal(body.goalUsdc);
  if (goalUsdc === null) {
    return { ok: false, error: "La meta debe ser un monto entre 0,01 y 100000 USDC, con hasta 7 decimales." };
  }

  let deadline: string | null = null;
  if (body.deadline !== undefined && body.deadline !== null) {
    if (typeof body.deadline !== "string") return { ok: false, error: "Revisa la fecha límite." };
    const at = Date.parse(body.deadline);
    if (!Number.isFinite(at)) return { ok: false, error: "Revisa la fecha límite." };
    if (at <= now) return { ok: false, error: "La fecha límite tiene que ser futura." };
    if (at > now + DEADLINE_MAX_MS) return { ok: false, error: "La fecha límite puede ser dentro de un año como máximo." };
    deadline = new Date(at).toISOString();
  }

  return { ok: true, value: { title, description, goalUsdc, deadline } };
}

// ------------------------------------------------------------------ cerrar

/** Quién cierra una vaquita: quien la creó, o owner/admin de la comunidad. */
export function canCloseVaquita(role: string | null, creatorId: string, actorId: string): boolean {
  if (role === null) return false;
  return creatorId === actorId || role === "owner" || role === "admin";
}

// ----------------------------------------------------------------- aportes

export type ContributionCode =
  | "own_vaquita"
  | "closed"
  | "payment_mismatch"
  | "payment_unverified"
  | "already_linked";

export type ContributionDecision =
  | { ok: true }
  | { ok: false; status: 403 | 409 | 422; code: ContributionCode; error: string };

export interface VaquitaFacts {
  creatorId: string;
  creatorWallet: string;
  status: string;
  /** Epoch ms, o null si no tiene fecha límite. */
  deadlineAt: number | null;
  /** Epoch ms. */
  createdAt: number;
}

export interface PaymentFactsForVaquita {
  fromWallet: string;
  toWallet: string;
  asset: string;
  unverified: boolean;
  /** Cierre del ledger (`paid_at`), epoch ms. */
  paidAt: number;
  /** Ya existe un aporte con este pago (en cualquier vaquita). */
  linked: boolean;
}

const deny = (status: 403 | 409 | 422, code: ContributionCode, error: string): ContributionDecision => ({
  ok: false,
  status,
  code,
  error,
});

/**
 * ¿Este pago ya registrado puede vincularse como aporte? Todo sale de los datos
 * guardados de `payments` y de la sesión, nunca del cuerpo del pedido.
 * Orden: la vaquita (propia, cerrada o vencida), después el pago.
 */
export function checkContribution(
  vaquita: VaquitaFacts,
  payment: PaymentFactsForVaquita,
  session: { profileId: string; wallet: string },
  now: number,
): ContributionDecision {
  if (session.profileId === vaquita.creatorId) {
    return deny(403, "own_vaquita", "No puedes aportar a tu propia vaquita: el dinero ya es tuyo.");
  }
  if (vaquita.status !== "open") return deny(409, "closed", "Esta vaquita ya está cerrada.");
  if (vaquita.deadlineAt !== null && vaquita.deadlineAt <= now) {
    return deny(409, "closed", "La fecha límite de esta vaquita ya pasó.");
  }
  if (payment.asset !== "USDC") return deny(422, "payment_mismatch", "Solo se puede aportar con pagos en USDC.");
  if (payment.fromWallet !== session.wallet) {
    return deny(422, "payment_mismatch", "Ese pago no lo enviaste tú.");
  }
  if (payment.toWallet !== vaquita.creatorWallet) {
    return deny(422, "payment_mismatch", "Ese pago no fue a la wallet de quien creó la vaquita.");
  }
  if (payment.paidAt < vaquita.createdAt) {
    return deny(422, "payment_mismatch", "Ese pago es anterior a la vaquita.");
  }
  if (payment.unverified) {
    return deny(422, "payment_unverified", "Ese pago no pasó por la confirmación con PIN, así que no cuenta como aporte.");
  }
  if (payment.linked) return deny(409, "already_linked", "Ese pago ya se usó como aporte.");
  return { ok: true };
}

// ---------------------------------------------------------------- progreso

export interface VaquitaProgress {
  /** 0..100, entero hacia abajo (99,9 % se muestra 99: no se promete la meta antes de llegar). */
  percent: number;
  reached: boolean;
  /** Lo que falta para la meta, 7 lugares ("0.0000000" si ya se alcanzó). */
  remainingUsdc: string;
}

/** Progreso a partir de la meta y lo recaudado (decimales como texto, 7 lugares). */
export function vaquitaProgress(goalUsdc: string, raisedUsdc: string): VaquitaProgress {
  const goal = toStroops(goalUsdc);
  const raised = toStroops(raisedUsdc);
  if (goal === null || raised === null || goal <= BigInt(0)) {
    return { percent: 0, reached: false, remainingUsdc: fromStroops(BigInt(0)) };
  }
  const reached = raised >= goal;
  const percent = reached ? 100 : Number((raised * BigInt(100)) / goal);
  return { percent, reached, remainingUsdc: fromStroops(reached ? BigInt(0) : goal - raised) };
}
