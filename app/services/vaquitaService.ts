/**
 * Vaquita: un pozo común dentro de una comunidad ("Asado del sábado – meta 50
 * USDC – hasta el viernes"). Los miembros aportan USDC, se ve el progreso y quién
 * aportó. Solo USDC. Contrato compartido entre la UI y el backend.
 *
 * La Vaquita NO mueve dinero por su cuenta. Flujo de un aporte:
 * 1. La UI paga con el flujo normal de pagos: `securityService.approve({ to:
 *    vaquita.creatorWallet, asset: 'USDC', amount, pin })` y después
 *    `walletService.sendPayment({ ..., approval })`. El dinero va directo a la
 *    wallet de quien creó la vaquita.
 * 2. Con el `WalletTransaction` que devuelve `sendPayment`, la UI llama a
 *    `vaquitaService.contribute(vaquita.id, tx.id)`. En modo api, `tx.id` es el id
 *    del pago registrado en el servidor.
 * 3. El servidor revisa con el pago guardado (no con lo que mande la UI): que lo
 *    enviaste tú, a la wallet del creador, en USDC, con PIN, después de crear la
 *    vaquita, y que no se usó antes. Si todo cuadra, lo cuenta como aporte.
 *
 * Si el pago salió pero el vínculo falla (red, por ejemplo), el dinero ya está en
 * la wallet del creador: la UI puede reintentar `contribute` con el mismo `tx.id`
 * (un pago cuenta una sola vez). `closed` en ese paso significa que la vaquita se
 * cerró o venció justo antes de vincular.
 *
 * `raisedUsdc` y `contributorsCount` los calcula el servidor sumando los aportes.
 * Una vaquita `open` con `deadline` ya pasada ya no recibe aportes (`closed`):
 * la UI debe mostrarla como vencida.
 */
import type { User } from '../types';

export type VaquitaStatus = 'open' | 'closed';

export interface Vaquita {
  id: string;
  /** En modo demo (localStorage) es el slug de la comunidad. */
  communityId: string;
  /** Quien la creó: `id`, `username` (@usuario), `displayName` y `avatar` (imagen lista para <img>). */
  creator: User;
  /** Dirección G… donde llegan los aportes (la wallet de quien la creó). */
  creatorWallet: string;
  title: string;
  description: string | null;
  /** Meta en USDC. */
  goalUsdc: number;
  /** Lo aportado hasta ahora, en USDC. */
  raisedUsdc: number;
  /** Cuántas personas distintas aportaron. */
  contributorsCount: number;
  /** ISO, o null si no tiene fecha límite. */
  deadline: string | null;
  status: VaquitaStatus;
  /** ISO. */
  createdAt: string;
  /** ISO, o null si sigue abierta. */
  closedAt: string | null;
}

export interface VaquitaContribution {
  id: string;
  /** Quien aportó (perfil público). */
  contributor: User;
  amountUsdc: number;
  /** Hash de la transacción en Stellar. */
  txHash: string;
  /** ISO: cuándo se hizo el pago. */
  createdAt: string;
}

export interface VaquitaDetail {
  vaquita: Vaquita;
  /** El aporte más reciente primero. */
  contributions: VaquitaContribution[];
}

export interface CreateVaquitaInput {
  /** 1 a 60 caracteres. */
  title: string;
  /** Hasta 280 caracteres. */
  description?: string;
  /** Entre 0,01 y 100000 USDC, hasta 7 decimales. */
  goalUsdc: number;
  /** ISO: tiene que ser futura y dentro de un año como máximo. */
  deadline?: string;
}

/** Códigos de error que la UI distingue (vienen en `VaquitaError.code`). */
export type VaquitaErrorCode =
  | 'not_member' // no es miembro de la comunidad
  | 'not_found' // la vaquita (o la comunidad) no existe
  | 'forbidden' // cerrar: solo quien la creó o un admin
  | 'own_vaquita' // no se aporta a la propia vaquita
  | 'closed' // cerrada o con la fecha límite vencida
  | 'payment_not_found' // ese pago no existe
  | 'payment_mismatch' // el pago no es tuyo, no es USDC, no fue al creador o es anterior a la vaquita
  | 'payment_unverified' // el pago no pasó por la confirmación con PIN
  | 'already_linked' // ese pago ya se usó como aporte
  | 'invalid_input' // título, meta o fecha inválidos (el mensaje dice cuál)
  | 'quota_exceeded' // 20 abiertas por comunidad o 10 por hora
  | 'rate_limited'
  | 'unknown';

export class VaquitaError extends Error {
  constructor(
    message: string,
    public code: VaquitaErrorCode,
  ) {
    super(message);
    this.name = 'VaquitaError';
  }
}

export interface IVaquitaService {
  /** Las vaquitas de la comunidad: abiertas primero, después las cerradas recientes. Solo miembros. */
  list(communitySlug: string): Promise<Vaquita[]>;
  /** Una vaquita con sus aportes. Solo miembros de su comunidad. */
  get(id: string): Promise<VaquitaDetail>;
  /** Cualquier miembro puede crear una. Lanza `VaquitaError`. */
  create(communitySlug: string, input: CreateVaquitaInput): Promise<Vaquita>;
  /** Cuenta un pago ya registrado (id de `WalletTransaction`) como aporte. Lanza `VaquitaError`. */
  contribute(id: string, paymentId: string): Promise<{ vaquita: Vaquita; contribution: VaquitaContribution }>;
  /** Cierra la vaquita (quien la creó o un admin). No se reabre. */
  close(id: string): Promise<Vaquita>;
}
