/**
 * Retos (migración 0015): reglas de tres en raya y de piedra, papel o tijera
 * (turno, casilla, ganador, empate, jugada oculta, mejor de 3), puntos,
 * caducidad, permisos, forma del SQL, la migración y las rutas con un pool falso.
 * Sin red ni base de datos.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";
import { Keypair } from "@stellar/stellar-base";

import { GET as retosGet, POST as retosPost } from "../app/api/communities/[slug]/retos/route.ts";
import { GET as rankingGet } from "../app/api/communities/[slug]/retos/ranking/route.ts";
import { GET as retoGet } from "../app/api/retos/[id]/route.ts";
import { POST as acceptPost } from "../app/api/retos/[id]/accept/route.ts";
import { POST as declinePost } from "../app/api/retos/[id]/decline/route.ts";
import { POST as movePost } from "../app/api/retos/[id]/move/route.ts";
import { resetApiLimits } from "../lib/core/api-limits.ts";
import * as sql from "../lib/core/db/retos-sql.ts";
import { profileIdFromWallet } from "../lib/core/ids.ts";
import { SESSION_COOKIE, signSessionCookie } from "../lib/core/session-cookie.ts";
import {
  POINTS,
  RETO_TTL_MS,
  acceptReto,
  applyMove,
  declineReto,
  initialState,
  normalizeState,
  parseRetoCreate,
  parseRetoMove,
  pointsFor,
  pptBeats,
  pptOutcome,
  pptScore,
  settleDue,
  tttWinner,
  viewReto,
  type Mark,
  type PptChoice,
  type PptRound,
  type PptView,
  type RetoCore,
} from "../lib/core/retos-rules.ts";

const SECRET = randomBytes(24).toString("hex");
const SECRET_BYTES = Buffer.from(SECRET);
const NOW = Date.parse("2026-10-09T12:00:00Z");
const HOUR = 60 * 60 * 1000;

const ALICE = Keypair.random().publicKey(); // la sesión
const BOB = Keypair.random().publicKey();
const CAROL = Keypair.random().publicKey();
const aliceId = profileIdFromWallet(ALICE);
const bobId = profileIdFromWallet(BOB);
const carolId = profileIdFromWallet(CAROL);

function core(over: Partial<RetoCore> = {}): RetoCore {
  return {
    game: "ttt",
    status: "active",
    challengerId: aliceId,
    opponentId: bobId,
    turnProfileId: aliceId,
    winnerId: null,
    state: initialState("ttt"),
    createdAt: NOW - HOUR,
    updatedAt: NOW - HOUR,
    ...over,
  };
}

const board = (cells: string): Array<Mark | null> => [...cells].map((c) => (c === "X" || c === "O" ? c : null));

function pptCore(rounds: PptRound[], over: Partial<RetoCore> = {}): RetoCore {
  return core({ game: "ppt", turnProfileId: null, state: { rounds }, ...over });
}

// ------------------------------------------------------------ entrada

test("parseRetoCreate: juego y oponente por @usuario o por id", () => {
  assert.deepEqual(parseRetoCreate({ game: "ttt", opponent: "@Bob_1" }), {
    ok: true,
    value: { game: "ttt", opponent: { kind: "username", username: "bob_1" } },
  });
  assert.deepEqual(parseRetoCreate({ game: "ppt", opponent: "bob" }), {
    ok: true,
    value: { game: "ppt", opponent: { kind: "username", username: "bob" } },
  });
  const byId = parseRetoCreate({ game: "ppt", opponent: bobId });
  assert.ok(byId.ok && byId.value.opponent.kind === "id");
  for (const bad of [null, [], "x", { game: "dados", opponent: "bob" }, { game: "ttt" }, { game: "ttt", opponent: 5 }, { game: "ttt", opponent: "@a" }, { game: "ttt", opponent: "no valido!" }]) {
    assert.equal(parseRetoCreate(bad).ok, false, JSON.stringify(bad));
  }
});

test("parseRetoMove: ttt pide una casilla 0..8; ppt pide piedra, papel o tijera", () => {
  assert.deepEqual(parseRetoMove("ttt", { cell: 4 }), { ok: true, value: { cell: 4 } });
  for (const bad of [{ cell: -1 }, { cell: 9 }, { cell: 1.5 }, { cell: "3" }, { choice: "piedra" }, {}, null]) {
    assert.equal(parseRetoMove("ttt", bad).ok, false, JSON.stringify(bad));
  }
  assert.deepEqual(parseRetoMove("ppt", { choice: "papel" }), { ok: true, value: { choice: "papel" } });
  for (const bad of [{ choice: "lagarto" }, { choice: 1 }, { cell: 1 }, {}, []]) {
    assert.equal(parseRetoMove("ppt", bad).ok, false, JSON.stringify(bad));
  }
});

test("normalizeState: rechaza lo que no tiene la forma del juego", () => {
  assert.ok(normalizeState("ttt", { board: Array(9).fill(null) }));
  assert.equal(normalizeState("ttt", { board: Array(8).fill(null) }), null);
  assert.equal(normalizeState("ttt", { board: Array(9).fill("Z") }), null);
  assert.equal(normalizeState("ttt", null), null);
  assert.ok(normalizeState("ppt", { rounds: [{ c: "piedra", o: null }] }));
  assert.equal(normalizeState("ppt", { rounds: [{ c: "lagarto", o: null }] }), null);
  assert.equal(normalizeState("ppt", { rounds: Array(6).fill({ c: null, o: null }) }), null);
});

// ------------------------------------------------------------ tres en raya

test("tttWinner: las 8 líneas y el tablero sin ganador", () => {
  const lines = ["XXX......", "...XXX...", "......XXX", "X..X..X..", ".X..X..X.", "..X..X..X", "X...X...X", "..X.X.X.."];
  for (const l of lines) assert.equal(tttWinner(board(l)), "X", l);
  assert.equal(tttWinner(board("OOO......")), "O");
  assert.equal(tttWinner(board("XOXXOOOXX")), null);
  assert.equal(tttWinner(board(".........")), null);
});

test("ttt: quien reta es X y empieza; se alternan los turnos", () => {
  const accepted = acceptReto(core({ status: "pending", turnProfileId: null }), bobId);
  assert.ok(accepted.ok);
  assert.equal(accepted.status, "active");
  assert.equal(accepted.turnProfileId, aliceId);

  const first = applyMove(core(), aliceId, { cell: 4 });
  assert.ok(first.ok && first.status === "active");
  assert.deepEqual((first.state as { board: unknown[] }).board[4], "X");
  assert.equal(first.turnProfileId, bobId);

  const second = applyMove(core({ state: first.state, turnProfileId: bobId }), bobId, { cell: 0 });
  assert.ok(second.ok);
  assert.equal((second.state as { board: unknown[] }).board[0], "O");
  assert.equal(second.turnProfileId, aliceId);
});

test("ttt: el servidor valida el turno, la casilla libre y el rango", () => {
  const notTurn = applyMove(core(), bobId, { cell: 0 });
  assert.ok(!notTurn.ok);
  assert.equal(notTurn.code, "not_your_turn");
  assert.equal(notTurn.status, 409);

  const taken = applyMove(core({ state: { board: board("X........") }, turnProfileId: bobId }), bobId, { cell: 0 });
  assert.ok(!taken.ok);
  assert.equal(taken.code, "cell_taken");

  for (const cell of [-1, 9, 2.5]) {
    const out = applyMove(core(), aliceId, { cell });
    assert.ok(!out.ok && out.code === "invalid_move", String(cell));
  }
  const wrongKind = applyMove(core(), aliceId, { choice: "piedra" });
  assert.ok(!wrongKind.ok && wrongKind.code === "invalid_move");

  const stranger = applyMove(core(), carolId, { cell: 1 });
  assert.ok(!stranger.ok && stranger.code === "not_player" && stranger.status === 403);

  const notActive = applyMove(core({ status: "pending" }), aliceId, { cell: 1 });
  assert.ok(!notActive.ok && notActive.code === "not_active");
  const done = applyMove(core({ status: "finished" }), aliceId, { cell: 1 });
  assert.ok(!done.ok && done.code === "not_active");
});

test("ttt: gana quien completa una línea y se acaba la partida", () => {
  const out = applyMove(core({ state: { board: board("XX.OO....") } }), aliceId, { cell: 2 });
  assert.ok(out.ok);
  assert.equal(out.status, "finished");
  assert.equal(out.winnerId, aliceId);
  assert.equal(out.turnProfileId, null);

  const bobWins = applyMove(core({ state: { board: board("XX.OO.X..") }, turnProfileId: bobId }), bobId, { cell: 5 });
  assert.ok(bobWins.ok && bobWins.status === "finished" && bobWins.winnerId === bobId);
});

test("ttt: tablero lleno sin ganador es empate", () => {
  // X O X / X O O / O X .  -> X juega la última casilla (8) sin completar línea.
  const out = applyMove(core({ state: { board: board("XOXXOOOX.") } }), aliceId, { cell: 8 });
  assert.ok(out.ok);
  assert.equal(out.status, "finished");
  assert.equal(out.winnerId, null);
});

// ------------------------------------------------------ piedra, papel o tijera

test("pptBeats: las 3 reglas y el empate", () => {
  assert.equal(pptBeats("piedra", "tijera"), 1);
  assert.equal(pptBeats("papel", "piedra"), 1);
  assert.equal(pptBeats("tijera", "papel"), 1);
  assert.equal(pptBeats("tijera", "piedra"), -1);
  assert.equal(pptBeats("piedra", "piedra"), 0);
});

test("ppt: cada quien juega una vez por ronda; las dos juegan a la vez (sin turno)", () => {
  const one = applyMove(pptCore([]), aliceId, { choice: "piedra" });
  assert.ok(one.ok && one.status === "active" && one.turnProfileId === null);
  assert.deepEqual((one.state as { rounds: PptRound[] }).rounds, [{ c: "piedra", o: null }]);

  const again = applyMove(pptCore((one.state as { rounds: PptRound[] }).rounds), aliceId, { choice: "papel" });
  assert.ok(!again.ok && again.code === "already_played" && again.status === 409);

  const two = applyMove(pptCore((one.state as { rounds: PptRound[] }).rounds), bobId, { choice: "tijera" });
  assert.ok(two.ok);
  assert.deepEqual((two.state as { rounds: PptRound[] }).rounds, [{ c: "piedra", o: "tijera" }]);

  const badKind = applyMove(pptCore([]), aliceId, { cell: 3 });
  assert.ok(!badKind.ok && badKind.code === "invalid_move");
  const stranger = applyMove(pptCore([]), carolId, { choice: "papel" });
  assert.ok(!stranger.ok && stranger.code === "not_player");
});

test("ppt: la respuesta nunca incluye la jugada pendiente de la otra persona", () => {
  // Alice ya jugó "piedra"; Bob todavía no.
  const c = pptCore([{ c: "piedra", o: null }]);
  const bobView = viewReto(c, bobId);
  assert.ok(bobView);
  const bobState = bobView.state as PptView;
  assert.deepEqual(bobState.current, { mine: null, opponentPlayed: true });
  assert.equal(bobView.yourTurn, true);
  assert.equal(JSON.stringify(bobView).includes("piedra"), false);

  const aliceView = viewReto(c, aliceId);
  assert.ok(aliceView);
  assert.deepEqual((aliceView.state as PptView).current, { mine: "piedra", opponentPlayed: false });
  assert.equal(aliceView.yourTurn, false);

  // Y al revés: la jugada de Bob no se ve para Alice.
  const c2 = pptCore([{ c: null, o: "tijera" }]);
  assert.equal(JSON.stringify(viewReto(c2, aliceId)).includes("tijera"), false);
  assert.equal(JSON.stringify(viewReto(c2, bobId)).includes("tijera"), true);

  // Una ajena no ve nada.
  assert.equal(viewReto(c, carolId), null);
});

test("ppt: la ronda se revela cuando las dos jugaron", () => {
  const c = pptCore([{ c: "piedra", o: "tijera" }, { c: "papel", o: null }]);
  const v = viewReto(c, bobId)?.state as PptView;
  assert.deepEqual(v.rounds, [{ challenger: "piedra", opponent: "tijera", winner: "challenger" }]);
  assert.deepEqual(v.score, { challenger: 1, opponent: 0 });
  assert.deepEqual(v.current, { mine: null, opponentPlayed: true });
  // La jugada pendiente de la ronda 2 (papel) no viaja para Bob.
  assert.equal(JSON.stringify(v).includes("papel"), false);
});

function playRound(c: RetoCore, a: PptChoice, b: PptChoice): ReturnType<typeof applyMove> {
  const one = applyMove(c, aliceId, { choice: a });
  assert.ok(one.ok);
  return applyMove({ ...c, state: one.state }, bobId, { choice: b });
}

test("ppt: mejor de 3, gana quien llega a 2 rondas", () => {
  const r1 = playRound(pptCore([]), "piedra", "tijera");
  assert.ok(r1.ok && r1.status === "active");
  const r2 = playRound(pptCore((r1.state as { rounds: PptRound[] }).rounds), "papel", "tijera");
  assert.ok(r2.ok && r2.status === "active"); // 1 a 1
  const r3 = playRound(pptCore((r2.state as { rounds: PptRound[] }).rounds), "tijera", "papel");
  assert.ok(r3.ok);
  assert.equal(r3.status, "finished");
  assert.equal(r3.winnerId, aliceId);

  // Dos seguidas termina antes.
  const quick = playRound(pptCore((playRound(pptCore([]), "papel", "piedra") as { state: { rounds: PptRound[] } }).state.rounds), "papel", "piedra");
  assert.ok(quick.ok && quick.status === "finished" && quick.winnerId === aliceId);

  const bob = playRound(pptCore([{ c: "piedra", o: "papel" }]), "piedra", "papel");
  assert.ok(bob.ok && bob.status === "finished" && bob.winnerId === bobId);
});

test("ppt: las rondas empatadas se repiten; tope de 5 rondas", () => {
  const tie = playRound(pptCore([]), "piedra", "piedra");
  assert.ok(tie.ok && tie.status === "active");
  assert.deepEqual(pptScore((tie.state as { rounds: PptRound[] }).rounds), { challenger: 0, opponent: 0 });

  // 1-1 y tres empates: 5 rondas sin definir -> empate.
  const rounds: PptRound[] = [
    { c: "piedra", o: "tijera" }, { c: "tijera", o: "piedra" },
    { c: "papel", o: "papel" }, { c: "papel", o: "papel" }, { c: "papel", o: "papel" },
  ];
  assert.deepEqual(pptOutcome(rounds), { finished: true, winner: null });
  assert.deepEqual(pptOutcome(rounds.slice(0, 4)), { finished: false, winner: null });
  const last = playRound(pptCore(rounds.slice(0, 4).concat([{ c: null, o: null }]).slice(0, 4)), "papel", "papel");
  assert.ok(last.ok && last.status === "finished" && last.winnerId === null);
});

// ------------------------------------------------------------ flujo

test("aceptar y rechazar: solo la persona retada, solo si está pendiente", () => {
  const pending = core({ status: "pending", turnProfileId: null });
  const byChallenger = acceptReto(pending, aliceId);
  assert.ok(!byChallenger.ok && byChallenger.code === "not_opponent" && byChallenger.status === 403);
  const byStranger = acceptReto(pending, carolId);
  assert.ok(!byStranger.ok && byStranger.code === "not_player");
  const late = acceptReto(core(), bobId);
  assert.ok(!late.ok && late.code === "not_pending" && late.status === 409);

  const declined = declineReto(pending, bobId);
  assert.ok(declined.ok && declined.status === "declined" && declined.winnerId === null);
  const declineByChallenger = declineReto(pending, aliceId);
  assert.ok(!declineByChallenger.ok && declineByChallenger.code === "not_opponent");
  const declineActive = declineReto(core(), bobId);
  assert.ok(!declineActive.ok && declineActive.code === "not_pending");

  // En ppt no hay turno al aceptar.
  const ppt = acceptReto(pptCore([], { status: "pending" }), bobId);
  assert.ok(ppt.ok && ppt.turnProfileId === null);
});

// ------------------------------------------------------------ caducidad

test("caducidad: un pendiente caduca a las 24 h", () => {
  const pending = core({ status: "pending", turnProfileId: null, createdAt: NOW - RETO_TTL_MS + 1000 });
  assert.equal(settleDue(pending, NOW), null);
  assert.deepEqual(settleDue({ ...pending, createdAt: NOW - RETO_TTL_MS }, NOW), { status: "expired", winnerId: null });
  assert.equal(settleDue(core({ status: "finished" }), NOW + 10 * RETO_TTL_MS), null);
});

test("caducidad ttt: quien tenía el turno abandonó, gana la otra persona", () => {
  const idle = core({ turnProfileId: bobId, updatedAt: NOW - RETO_TTL_MS });
  assert.deepEqual(settleDue(idle, NOW), { status: "finished", winnerId: aliceId });
  const idleAlice = core({ turnProfileId: aliceId, updatedAt: NOW - RETO_TTL_MS });
  assert.deepEqual(settleDue(idleAlice, NOW), { status: "finished", winnerId: bobId });
  assert.equal(settleDue(core({ turnProfileId: bobId, updatedAt: NOW - RETO_TTL_MS + 1000 }), NOW), null);
});

test("caducidad ppt: gana quien ya jugó la ronda; si nadie jugó, caduca sin puntos", () => {
  const aliceOnly = pptCore([{ c: "piedra", o: null }], { updatedAt: NOW - RETO_TTL_MS });
  assert.deepEqual(settleDue(aliceOnly, NOW), { status: "finished", winnerId: aliceId });
  const bobOnly = pptCore([{ c: null, o: "papel" }], { updatedAt: NOW - RETO_TTL_MS });
  assert.deepEqual(settleDue(bobOnly, NOW), { status: "finished", winnerId: bobId });
  const nobody = pptCore([], { updatedAt: NOW - RETO_TTL_MS });
  assert.deepEqual(settleDue(nobody, NOW), { status: "expired", winnerId: null });
  const between = pptCore([{ c: "piedra", o: "papel" }], { updatedAt: NOW - RETO_TTL_MS });
  assert.deepEqual(settleDue(between, NOW), { status: "expired", winnerId: null });
});

// ------------------------------------------------------------ puntos

test("puntos: ganar 3, empatar 1, perder 0; solo los terminados cuentan", () => {
  assert.deepEqual(POINTS, { win: 3, draw: 1, loss: 0 });
  const won = core({ status: "finished", winnerId: aliceId });
  assert.equal(pointsFor(won, aliceId), 3);
  assert.equal(pointsFor(won, bobId), 0);
  const drawn = core({ status: "finished", winnerId: null });
  assert.equal(pointsFor(drawn, aliceId), 1);
  assert.equal(pointsFor(drawn, bobId), 1);
  assert.equal(pointsFor(core({ status: "expired" }), aliceId), 0);
  assert.equal(pointsFor(core({ status: "declined" }), aliceId), 0);
  assert.equal(pointsFor(core(), aliceId), 0);
});

// ------------------------------------------------------------ SQL

test("SQL: todo va parametrizado y las reglas viajan dentro de la sentencia", () => {
  const hostile = "x'; drop table retos; --";
  for (const query of [
    sql.retoById(hostile),
    sql.retoByIdForUpdate(hostile),
    sql.listMyRetos(hostile, hostile, 10),
    sql.openRetoIdsBetween(hostile, hostile, hostile, hostile),
    sql.dueRetoIdsFor(hostile, hostile),
    sql.insertReto(hostile, hostile, hostile, hostile, { board: [] }),
    sql.updateReto(hostile, hostile, { status: hostile, state: {}, turnProfileId: hostile, winnerId: hostile }),
    sql.retosRanking(hostile, 50, 3, 1),
  ]) {
    assert.doesNotMatch(query.text, /drop table/);
    assert.match(query.text, /\$1/);
  }
  assert.match(sql.retoByIdForUpdate("a").text, /for update of r/);

  const insert = sql.insertReto("c", "ttt", "me", "other", { board: [] }).text;
  // Las dos personas tienen que ser miembros, dentro de la misma sentencia.
  assert.equal((insert.match(/from public\.members m where m\.community_id = \$1::uuid and m\.profile_id = \$[34]::uuid/g) ?? []).length, 2);

  const update = sql.updateReto("id", "active", { status: "finished", state: {}, turnProfileId: null, winnerId: null });
  assert.match(update.text, /where id = \$1 and status = \$2/);
  assert.match(update.text, /finished_at = case when \$3 in \('pending', 'active'\) then null else now\(\) end/);

  const ranking = sql.retosRanking("c", 50, 3, 1);
  assert.deepEqual(ranking.values, ["c", 50, 3, 1]);
  assert.match(ranking.text, /r\.status = 'finished'/);
  assert.match(ranking.text, /join public\.members m on m\.community_id = \$1/);
  assert.match(ranking.text, /\$3::int/);
});

// ------------------------------------------------------------ migración

const migration = readFileSync(new URL("../db/migrations/0015_retos.sql", import.meta.url), "utf8");

test("migración 0015: tabla, checks, índices y cuotas", () => {
  assert.match(migration, /create table if not exists public\.retos/);
  assert.match(migration, /community_id\s+uuid not null references public\.communities \(id\) on delete cascade/);
  assert.match(migration, /game in \('ttt', 'ppt'\)/);
  assert.match(migration, /status in \('pending', 'active', 'finished', 'declined', 'expired'\)/);
  assert.match(migration, /challenger_id <> opponent_id/);
  assert.match(migration, /winner_id in \(challenger_id, opponent_id\)/);
  assert.match(migration, /state\s+jsonb not null/);
  assert.match(migration, /create unique index if not exists retos_open_pair_key/);
  assert.match(migration, /create trigger retos_before_insert_quota\s+before insert on public\.retos/);
  assert.match(migration, /v_pending >= 10/);
  assert.match(migration, /quota_exceeded:retos_pending/);
  assert.match(migration, /v_hour >= 30/);
  assert.match(migration, /quota_exceeded:retos_per_hour/);
  assert.match(migration, /pg_advisory_xact_lock/);
  // Sin dinero.
  assert.doesNotMatch(migration, /usdc|amount|payment/i);
});

test("migración 0015: idempotente", () => {
  assert.doesNotMatch(migration, /^create table (?!if not exists)/im);
  assert.doesNotMatch(migration, /^create (unique )?index (?!if not exists)/im);
  const adds = migration.match(/add constraint (\w+)/g) ?? [];
  const drops = migration.match(/drop constraint if exists (\w+)/g) ?? [];
  assert.equal(adds.length, drops.length);
  assert.match(migration, /drop trigger if exists retos_before_insert_quota/);
  assert.doesNotMatch(migration, /\bdrop table\b/i);
});

// ------------------------------------------------------ rutas (pool falso)

const POOL_KEY = Symbol.for("kosmovia.pg.pool");
type Call = { text: string; values: unknown[] };

function installPool(handler: (text: string, values: unknown[]) => unknown[]): Call[] {
  const calls: Call[] = [];
  const run = async (text: string, values?: unknown[]) => {
    calls.push({ text, values: values ?? [] });
    return { rows: handler(text, values ?? []) };
  };
  (globalThis as Record<symbol, unknown>)[POOL_KEY] = {
    query: run,
    async connect() {
      return { query: run, release() {} };
    },
  };
  return calls;
}

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[POOL_KEY];
  resetApiLimits();
});

const API_ENV = { KOSMOVIA_DATA_BACKEND: "api", DATABASE_URL: "postgresql://u:p@localhost:5432/test", SESSION_SECRET: SECRET };

function withApiEnv(fn: () => Promise<void>) {
  return async () => {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(API_ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
}

const cookie = () => `${SESSION_COOKIE}=${signSessionCookie({ secret: SECRET_BYTES, wallet: ALICE, now: Date.now() }).token}`;

function req(path: string, method: string, body?: unknown, withCookie = true): Request {
  const headers: Record<string, string> = {};
  if (withCookie) headers.cookie = cookie();
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://kosmovia.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const COMMUNITY_ID = "11111111-1111-4111-8111-111111111111";
const RETO_ID = "22222222-2222-4222-8222-222222222222";
const slugCtx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const author = (id: string, username: string) => ({ id, username, display_name: username, avatar_seed: null, avatar_style: null });
const iso = (ms: number) => new Date(ms).toISOString().replace("Z", "000Z");

function retoRow(over: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: RETO_ID,
    community_id: COMMUNITY_ID,
    game: "ttt",
    status: "active",
    challenger_id: aliceId,
    opponent_id: bobId,
    turn_profile_id: aliceId,
    winner_id: null,
    state: { board: board("........."), },
    created_at: iso(now - HOUR),
    updated_at: iso(now - HOUR),
    finished_at: null,
    challenger: author(aliceId, "alice"),
    opponent: author(bobId, "bob"),
    ...over,
  };
}

interface World {
  /** Rol de la sesión (null = no es miembro). */
  role?: string | null;
  opponentRole?: string | null;
  reto?: Record<string, unknown> | null;
  insertThrows?: { code: string; message: string };
  insertReturnsNothing?: boolean;
}

function world(w: World = {}): Call[] {
  const role = w.role === undefined ? "member" : w.role;
  const opponentRole = w.opponentRole === undefined ? "member" : w.opponentRole;
  const reto = w.reto === null ? null : retoRow(w.reto ?? {});
  return installPool((text, values) => {
    if (text.includes("from public.communities c where c.slug")) return [{ id: COMMUNITY_ID, slug: "kosmo", name: "Kosmo", owner_id: bobId }];
    if (text.startsWith("select role from public.members")) {
      const who = values[1];
      const r = who === aliceId ? role : opponentRole;
      return r === null ? [] : [{ role: r }];
    }
    if (text.includes("lower(p.username)")) {
      return [{ id: bobId, wallet: BOB, username: "bob" }];
    }
    if (text.includes("where p.id = $1")) return [{ id: values[0], wallet: BOB, username: "bob" }];
    if (text.startsWith("insert into public.retos")) {
      if (w.insertThrows) throw Object.assign(new Error(w.insertThrows.message), { code: w.insertThrows.code });
      return w.insertReturnsNothing ? [] : [{ id: RETO_ID }];
    }
    if (text.startsWith("update public.retos")) return [{ id: RETO_ID }];
    if (text.includes("from public.retos r join public.profiles ch")) {
      if (text.includes("r.status in ('pending', 'active')")) return [];
      return reto ? [reto] : [];
    }
    if (text.includes("with sides as")) {
      return [{ profile: author(aliceId, "alice"), wins: 2, draws: 1, losses: 0, points: 7 }];
    }
    return [];
  });
}

const queryOf = (calls: Call[], fragment: string) => calls.find((c) => c.text.includes(fragment));

test(
  "GET /api/communities/[slug]/retos: sesión, miembros y la lista",
  withApiEnv(async () => {
    world();
    assert.equal((await retosGet(req("/x", "GET", undefined, false), slugCtx("kosmo"))).status, 401);

    world({ role: null });
    const outsider = await retosGet(req("/x", "GET"), slugCtx("kosmo"));
    assert.equal(outsider.status, 403);
    assert.equal(((await outsider.json()) as { code: string }).code, "not_member");

    const calls = world();
    const ok = await retosGet(req("/x", "GET"), slugCtx("kosmo"));
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { retos: Array<{ id: string; me: string; your_turn: boolean; state: { board: unknown[] } }> };
    assert.equal(body.retos.length, 1);
    assert.equal(body.retos[0].me, "challenger");
    assert.equal(body.retos[0].your_turn, true);
    assert.equal(body.retos[0].state.board.length, 9);
    assert.deepEqual(queryOf(calls, "(r.challenger_id = $2 or r.opponent_id = $2)")?.values.slice(0, 2), [COMMUNITY_ID, aliceId]);
  }),
);

test(
  "POST /api/communities/[slug]/retos: crea (201) con la sesión como retadora",
  withApiEnv(async () => {
    const calls = world();
    const ok = await retosPost(req("/x", "POST", { game: "ppt", opponent: "@bob" }), slugCtx("kosmo"));
    assert.equal(ok.status, 201);
    const insert = queryOf(calls, "insert into public.retos");
    // El retador es la sesión, no el cuerpo.
    assert.deepEqual(insert?.values.slice(0, 4), [COMMUNITY_ID, "ppt", aliceId, bobId]);
    assert.equal(insert?.values[4], JSON.stringify({ rounds: [] }));

    assert.equal((await retosPost(req("/x", "POST", { game: "dados", opponent: "@bob" }), slugCtx("kosmo"))).status, 400);
    assert.equal((await retosPost(req("/x", "POST", { game: "ttt" }), slugCtx("kosmo"))).status, 400);
    assert.equal((await retosPost(req("/x", "POST", { game: "ttt", opponent: "@bob" }, false), slugCtx("kosmo"))).status, 401);

    world({ role: null });
    assert.equal((await retosPost(req("/x", "POST", { game: "ttt", opponent: "@bob" }), slugCtx("kosmo"))).status, 403);

    world({ opponentRole: null });
    const notMember = await retosPost(req("/x", "POST", { game: "ttt", opponent: "@bob" }), slugCtx("kosmo"));
    assert.equal(notMember.status, 422);
    assert.equal(((await notMember.json()) as { code: string }).code, "opponent_not_member");

    // Retarse a sí misma.
    const self = await retosPost(req("/x", "POST", { game: "ttt", opponent: aliceId }), slugCtx("kosmo"));
    assert.equal(self.status, 400);
    assert.equal(((await self.json()) as { code: string }).code, "self_challenge");
  }),
);

test(
  "POST retos: las cuotas y el reto repetido responden con su código",
  withApiEnv(async () => {
    world({ insertThrows: { code: "P0001", message: "quota_exceeded:retos_pending" } });
    const quota = await retosPost(req("/x", "POST", { game: "ttt", opponent: "@bob" }), slugCtx("kosmo"));
    assert.equal(quota.status, 429);
    assert.equal(((await quota.json()) as { code: string }).code, "quota_exceeded");

    world({ insertThrows: { code: "23505", message: "duplicate key retos_open_pair_key" } });
    const dup = await retosPost(req("/x", "POST", { game: "ttt", opponent: "@bob" }), slugCtx("kosmo"));
    assert.equal(dup.status, 409);
    assert.equal(((await dup.json()) as { code: string }).code, "already_open");
  }),
);

test(
  "GET /api/retos/[id]: solo quienes juegan; ppt no filtra la jugada ajena",
  withApiEnv(async () => {
    // Alice (la sesión) consulta un ppt donde Bob ya jugó "tijera" y ella no.
    world({ reto: { game: "ppt", turn_profile_id: null, state: { rounds: [{ c: null, o: "tijera" }] } } });
    const res = await retoGet(req("/x", "GET"), idCtx(RETO_ID));
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text.includes("tijera"), false);
    const body = JSON.parse(text) as { reto: { state: { current: { mine: unknown; opponentPlayed: boolean } }; your_turn: boolean } };
    assert.deepEqual(body.reto.state.current, { mine: null, opponentPlayed: true });
    assert.equal(body.reto.your_turn, true);

    // Una ajena recibe 404: no se revela que existe.
    world({ reto: { challenger_id: bobId, opponent_id: carolId } });
    assert.equal((await retoGet(req("/x", "GET"), idCtx(RETO_ID))).status, 404);
    world({ reto: null });
    assert.equal((await retoGet(req("/x", "GET"), idCtx(RETO_ID))).status, 404);
    assert.equal((await retoGet(req("/x", "GET"), idCtx("no-es-uuid"))).status, 404);
    assert.equal((await retoGet(req("/x", "GET", undefined, false), idCtx(RETO_ID))).status, 401);

    // Alguien que se salió de la comunidad ya no lo ve.
    world({ role: null });
    assert.equal((await retoGet(req("/x", "GET"), idCtx(RETO_ID))).status, 403);
  }),
);

test(
  "POST /api/retos/[id]/move: ttt guarda la jugada, cambia el turno y valida",
  withApiEnv(async () => {
    const calls = world({ reto: { state: { board: board("....O....") } } });
    const ok = await movePost(req("/x", "POST", { cell: 0 }), idCtx(RETO_ID));
    assert.equal(ok.status, 200);
    const update = queryOf(calls, "update public.retos");
    assert.ok(update);
    assert.equal(update.values[1], "active");
    assert.equal(update.values[2], "active");
    assert.equal(JSON.parse(update.values[3] as string).board[0], "X");
    assert.equal(update.values[4], bobId);
    // La fila se bloqueó antes de decidir.
    assert.ok(queryOf(calls, "for update of r"));

    world({ reto: { turn_profile_id: bobId } });
    const notTurn = await movePost(req("/x", "POST", { cell: 0 }), idCtx(RETO_ID));
    assert.equal(notTurn.status, 409);
    assert.equal(((await notTurn.json()) as { code: string }).code, "not_your_turn");

    world({ reto: { state: { board: board("X........") } } });
    const taken = await movePost(req("/x", "POST", { cell: 0 }), idCtx(RETO_ID));
    assert.equal(taken.status, 409);
    assert.equal(((await taken.json()) as { code: string }).code, "cell_taken");

    world();
    assert.equal((await movePost(req("/x", "POST", { cell: 9 }), idCtx(RETO_ID))).status, 400);
    assert.equal((await movePost(req("/x", "POST", { choice: "piedra" }), idCtx(RETO_ID))).status, 400);

    world({ reto: { challenger_id: bobId, opponent_id: carolId } });
    assert.equal((await movePost(req("/x", "POST", { cell: 1 }), idCtx(RETO_ID))).status, 404);

    world({ role: null });
    assert.equal((await movePost(req("/x", "POST", { cell: 1 }), idCtx(RETO_ID))).status, 403);
    assert.equal((await movePost(req("/x", "POST", { cell: 1 }, false), idCtx(RETO_ID))).status, 401);
  }),
);

test(
  "POST /api/retos/[id]/move: ppt guarda la jugada oculta y no la devuelve",
  withApiEnv(async () => {
    const calls = world({ reto: { game: "ppt", turn_profile_id: null, state: { rounds: [] } } });
    const res = await movePost(req("/x", "POST", { choice: "papel" }), idCtx(RETO_ID));
    assert.equal(res.status, 200);
    const update = queryOf(calls, "update public.retos");
    assert.deepEqual(JSON.parse(update?.values[3] as string), { rounds: [{ c: "papel", o: null }] });
  }),
);

test(
  "POST /api/retos/[id]/move: una partida sin jugar 24 h se cierra y gana quien no abandonó",
  withApiEnv(async () => {
    // Le tocaba a Bob hace más de 24 h: gana Alice (la sesión), y su jugada se rechaza como caducada.
    const calls = world({ reto: { turn_profile_id: bobId, updated_at: iso(Date.now() - RETO_TTL_MS - HOUR) } });
    const res = await movePost(req("/x", "POST", { cell: 0 }), idCtx(RETO_ID));
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { code: string }).code, "expired");
    const update = queryOf(calls, "update public.retos");
    assert.equal(update?.values[2], "finished");
    assert.equal(update?.values[5], aliceId);
  }),
);

test(
  "accept y decline: solo la persona retada",
  withApiEnv(async () => {
    // Alice (la sesión) es la retadora: no puede aceptar.
    world({ reto: { status: "pending", turn_profile_id: null } });
    const byChallenger = await acceptPost(req("/x", "POST", {}), idCtx(RETO_ID));
    assert.equal(byChallenger.status, 403);
    assert.equal(((await byChallenger.json()) as { code: string }).code, "not_opponent");
    assert.equal((await declinePost(req("/x", "POST", {}), idCtx(RETO_ID))).status, 403);

    // Ahora Alice es la retada.
    const calls = world({ reto: { status: "pending", turn_profile_id: null, challenger_id: bobId, opponent_id: aliceId, challenger: author(bobId, "bob"), opponent: author(aliceId, "alice") } });
    assert.equal((await acceptPost(req("/x", "POST", {}), idCtx(RETO_ID))).status, 200);
    const update = queryOf(calls, "update public.retos");
    assert.equal(update?.values[2], "active");
    assert.equal(update?.values[4], bobId); // empieza quien retó

    const calls2 = world({ reto: { status: "pending", turn_profile_id: null, challenger_id: bobId, opponent_id: aliceId, challenger: author(bobId, "bob"), opponent: author(aliceId, "alice") } });
    assert.equal((await declinePost(req("/x", "POST", {}), idCtx(RETO_ID))).status, 200);
    assert.equal(queryOf(calls2, "update public.retos")?.values[2], "declined");

    // Ya activo: no se acepta otra vez.
    world({ reto: { challenger_id: bobId, opponent_id: aliceId } });
    assert.equal((await acceptPost(req("/x", "POST", {}), idCtx(RETO_ID))).status, 409);
  }),
);

test(
  "GET ranking: solo miembros, puntos de los retos terminados",
  withApiEnv(async () => {
    const calls = world();
    const res = await rankingGet(req("/x", "GET"), slugCtx("kosmo"));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ranking: Array<{ points: number }> };
    assert.equal(body.ranking[0].points, 7);
    assert.deepEqual(queryOf(calls, "with sides as")?.values, [COMMUNITY_ID, 50, 3, 1]);

    world({ role: null });
    assert.equal((await rankingGet(req("/x", "GET"), slugCtx("kosmo"))).status, 403);
    assert.equal((await rankingGet(req("/x", "GET", undefined, false), slugCtx("kosmo"))).status, 401);
  }),
);
