/**
 * Aprende Stellar (migración 0016): contenido, corrección en el servidor (el
 * cliente no recibe la respuesta correcta antes de responder), XP una sola vez,
 * insignias, misiones verificadas con datos reales, permisos de miembro, forma
 * del SQL, la migración y las rutas con un pool falso. Sin red ni base de datos.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";
import { Keypair } from "@stellar/stellar-base";

import { GET as lessonsGet } from "../app/api/academia/lessons/route.ts";
import { GET as lessonGet } from "../app/api/academia/lessons/[id]/route.ts";
import { POST as answersPost } from "../app/api/academia/lessons/[id]/answers/route.ts";
import { GET as missionsGet } from "../app/api/academia/missions/route.ts";
import { GET as rankingGet } from "../app/api/communities/[slug]/academia/ranking/route.ts";
import { LESSONS, getLesson } from "../lib/core/academia-content.ts";
import {
  BADGES,
  LESSON_XP,
  MISSIONS,
  MISSION_XP,
  PASS_SCORE,
  earnedBadges,
  gradeAnswers,
  lessonXpEarned,
  parseAnswers,
  publicLesson,
  summarize,
  totalXp,
} from "../lib/core/academia-rules.ts";
import { resetApiLimits } from "../lib/core/api-limits.ts";
import * as sql from "../lib/core/db/academia-sql.ts";
import { profileIdFromWallet } from "../lib/core/ids.ts";
import { SESSION_COOKIE, signSessionCookie } from "../lib/core/session-cookie.ts";

const SECRET = randomBytes(24).toString("hex");
const SECRET_BYTES = Buffer.from(SECRET);
const ALICE = Keypair.random().publicKey();
const aliceId = profileIdFromWallet(ALICE);

// ------------------------------------------------------------ contenido

test("contenido: 5 lecciones, 3 a 5 párrafos y 4 preguntas de 4 opciones", () => {
  assert.deepEqual(
    LESSONS.map((l) => l.id),
    ["que-es-stellar", "cuentas-y-claves", "xlm-y-usdc", "pagos-y-memos", "trustlines-y-anclas"],
  );
  for (const l of LESSONS) {
    assert.ok(l.paragraphs.length >= 3 && l.paragraphs.length <= 5, `${l.id} párrafos`);
    assert.equal(l.questions.length, 4, `${l.id} preguntas`);
    for (const q of l.questions) {
      assert.equal(q.options.length, 4);
      assert.equal(new Set(q.options).size, 4, "opciones distintas");
      assert.ok(q.correct >= 0 && q.correct <= 3);
      assert.ok(q.explanation.length > 10);
    }
    assert.match(l.id, /^[a-z0-9-]{1,40}$/); // lo exige el check de la migración
  }
});

test("contenido: sin voseo", () => {
  const all = JSON.stringify(LESSONS);
  for (const voseo of [/\bvos\b/i, /\btenés\b/i, /\bpodés\b/i, /\bsos\b/i, /\bquerés\b/i, /\bmirá\b/i, /\belegí\b/i]) {
    assert.doesNotMatch(all, voseo);
  }
});

// ------------------------------------------------------------ lo público

test("publicLesson: no incluye la respuesta correcta ni las explicaciones", () => {
  for (const l of LESSONS) {
    const pub = publicLesson(l);
    const text = JSON.stringify(pub);
    assert.doesNotMatch(text, /"correct"/);
    assert.doesNotMatch(text, /explanation/);
    for (const q of l.questions) assert.equal(text.includes(q.explanation), false);
    assert.equal(pub.questions.length, 4);
    assert.deepEqual(Object.keys(pub.questions[0]).sort(), ["options", "text"]);
  }
  assert.equal(getLesson("no-existe"), null);
});

// ------------------------------------------------------------ corrección

const lesson = LESSONS[0];
const allCorrect = lesson.questions.map((q) => q.correct as number);
const wrongOf = (c: number) => (c + 1) % 4;

test("parseAnswers: una opción 0..3 por pregunta", () => {
  assert.deepEqual(parseAnswers({ answers: [0, 1, 2, 3] }, lesson), { ok: true, value: [0, 1, 2, 3] });
  for (const bad of [null, [], {}, { answers: [0, 1, 2] }, { answers: [0, 1, 2, 3, 0] }, { answers: [0, 1, 2, 4] }, { answers: [0, 1, 2, -1] }, { answers: [0, 1, 2, 1.5] }, { answers: ["0", 1, 2, 3] }, { answers: "0123" }]) {
    assert.equal(parseAnswers(bad, lesson).ok, false, JSON.stringify(bad));
  }
});

test("gradeAnswers: el servidor corrige y revela la correcta con su explicación", () => {
  const perfect = gradeAnswers(lesson, allCorrect);
  assert.equal(perfect.score, 4);
  assert.equal(perfect.passed, true);
  assert.ok(perfect.corrections.every((c) => c.isCorrect));

  const three = gradeAnswers(lesson, [allCorrect[0], allCorrect[1], allCorrect[2], wrongOf(allCorrect[3])]);
  assert.equal(three.score, PASS_SCORE);
  assert.equal(three.passed, true);
  const miss = three.corrections[3];
  assert.equal(miss.isCorrect, false);
  assert.equal(miss.correct, allCorrect[3]);
  assert.equal(miss.chosen, wrongOf(allCorrect[3]));
  assert.equal(miss.explanation, lesson.questions[3].explanation);

  const two = gradeAnswers(lesson, allCorrect.map((c, i) => (i < 2 ? c : wrongOf(c))));
  assert.equal(two.score, 2);
  assert.equal(two.passed, false);
  assert.equal(gradeAnswers(lesson, allCorrect.map(wrongOf)).score, 0);
});

// ------------------------------------------------------------ XP e insignias

test("XP: 50 por lección la primera vez que se aprueba, nunca de nuevo; 100 por misión", () => {
  assert.equal(LESSON_XP, 50);
  assert.equal(MISSION_XP, 100);
  assert.equal(lessonXpEarned(true, false), 50);
  assert.equal(lessonXpEarned(true, true), 0);
  assert.equal(lessonXpEarned(false, false), 0);
  assert.equal(lessonXpEarned(false, true), 0);
  assert.equal(totalXp(0, 0), 0);
  assert.equal(totalXp(5, 3), 5 * 50 + 3 * 100);
  assert.equal(MISSIONS.length, 3);
});

test("insignias: Primeros pasos, Conoce Stellar y Manos a la obra", () => {
  assert.deepEqual(BADGES.map((b) => b.name), ["Primeros pasos", "Conoce Stellar", "Manos a la obra"]);
  assert.deepEqual(earnedBadges(0, 0), []);
  assert.deepEqual(earnedBadges(1, 0), ["primeros-pasos"]);
  assert.deepEqual(earnedBadges(4, 2), ["primeros-pasos"]);
  assert.deepEqual(earnedBadges(5, 2), ["primeros-pasos", "conoce-stellar"]);
  assert.deepEqual(earnedBadges(5, 3), ["primeros-pasos", "conoce-stellar", "manos-a-la-obra"]);
  assert.deepEqual(earnedBadges(0, 3), ["manos-a-la-obra"]);
  const s = summarize(1, 1);
  assert.equal(s.xp, 150);
  assert.deepEqual(s.badges.filter((b) => b.earned).map((b) => b.id), ["primeros-pasos"]);
});

// ------------------------------------------------------------ SQL

test("SQL: parametrizado; la mejor nota no baja y completed_at no se pisa", () => {
  const hostile = "x'; drop table academia_progress; --";
  for (const query of [
    sql.progressOf(hostile),
    sql.missionsOf(hostile),
    sql.recordLessonAttempt(hostile, hostile, 3, true),
    sql.insertMission(hostile, hostile),
    sql.hasPaymentPin(hostile),
    sql.hasVerifiedPayment(hostile),
    sql.hasVaquitaContribution(hostile),
    sql.academiaRanking(hostile, 50, 50, 100),
  ]) {
    assert.doesNotMatch(query.text, /drop table/);
    assert.match(query.text, /\$1/);
  }
  const attempt = sql.recordLessonAttempt("p", "l", 3, true).text;
  assert.match(attempt, /on conflict \(profile_id, lesson_id\) do update/);
  assert.match(attempt, /best_score = greatest\(p\.best_score, excluded\.best_score\)/);
  assert.match(attempt, /completed_at = coalesce\(p\.completed_at, excluded\.completed_at\)/);

  assert.match(sql.insertMission("p", "m").text, /on conflict \(profile_id, mission_id\) do nothing/);
});

test("SQL de las misiones: solo leen y usan datos reales de la sesión", () => {
  const pin = sql.hasPaymentPin("me");
  assert.match(pin.text, /^select/);
  assert.match(pin.text, /public\.payment_security where profile_id = \$1 and pin_hash is not null/);
  const pay = sql.hasVerifiedPayment("GWALLET");
  assert.match(pay.text, /^select/);
  assert.match(pay.text, /public\.payments where from_wallet = \$1 and unverified = false/);
  assert.deepEqual(pay.values, ["GWALLET"]);
  const vaq = sql.hasVaquitaContribution("me");
  assert.match(vaq.text, /^select/);
  assert.match(vaq.text, /public\.vaquita_contributions where contributor_id = \$1/);
  for (const q of [pin, pay, vaq]) assert.doesNotMatch(q.text, /\b(insert|update|delete)\b/i);
});

test("SQL del ranking: solo miembros de la comunidad con XP, el XP viene por parámetro", () => {
  const r = sql.academiaRanking("c", 50, 50, 100);
  assert.deepEqual(r.values, ["c", 50, 50, 100]);
  assert.match(r.text, /from public\.members m join public\.profiles a/);
  assert.match(r.text, /where m\.community_id = \$1/);
  assert.match(r.text, /\$3::int/);
  assert.match(r.text, /\$4::int/);
});

// ------------------------------------------------------------ migración

const migration = readFileSync(new URL("../db/migrations/0016_academia.sql", import.meta.url), "utf8");

test("migración 0016: progreso y misiones, únicos por perfil e ítem", () => {
  assert.match(migration, /create table if not exists public\.academia_progress/);
  assert.match(migration, /create table if not exists public\.academia_missions/);
  assert.match(migration, /primary key \(profile_id, lesson_id\)/);
  assert.match(migration, /primary key \(profile_id, mission_id\)/);
  assert.match(migration, /profile_id\s+uuid not null references public\.profiles \(id\) on delete cascade/);
  assert.match(migration, /best_score/);
  // El XP no se guarda.
  assert.doesNotMatch(migration, /\bxp\s+(integer|int|numeric)/i);
});

test("migración 0016: idempotente", () => {
  assert.doesNotMatch(migration, /^create table (?!if not exists)/im);
  assert.doesNotMatch(migration, /^create (unique )?index (?!if not exists)/im);
  const adds = migration.match(/add constraint (\w+)/g) ?? [];
  const drops = migration.match(/drop constraint if exists (\w+)/g) ?? [];
  assert.equal(adds.length, drops.length);
  assert.doesNotMatch(migration, /\bdrop table\b/i);
});

// ------------------------------------------------------ rutas (pool falso)

const POOL_KEY = Symbol.for("kosmovia.pg.pool");
type Call = { text: string; values: unknown[] };

function installPool(handler: (text: string, values: unknown[]) => unknown[]): Call[] {
  const calls: Call[] = [];
  (globalThis as Record<symbol, unknown>)[POOL_KEY] = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values: values ?? [] });
      return { rows: handler(text, values ?? []) };
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
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const slugCtx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const AT = "2026-10-09T10:00:00.000000Z";

interface World {
  /** lecciones ya completadas. */
  done?: string[];
  /** misiones ya otorgadas. */
  missions?: string[];
  pin?: boolean;
  payment?: boolean;
  contribution?: boolean;
  role?: string | null;
}

function world(w: World = {}): { calls: Call[]; state: { done: Set<string>; missions: Set<string> } } {
  const state = { done: new Set(w.done ?? []), missions: new Set(w.missions ?? []) };
  const role = w.role === undefined ? "member" : w.role;
  const calls = installPool((text, values) => {
    if (text.includes("from public.communities c where c.slug")) return [{ id: COMMUNITY_ID }];
    if (text.startsWith("select role from public.members")) return role === null ? [] : [{ role }];
    if (text.includes("from public.academia_progress") && text.includes("order by lesson_id")) {
      return [...state.done].map((id) => ({ lesson_id: id, best_score: 4, completed_at: AT }));
    }
    if (text.includes("from public.academia_missions where profile_id")) {
      return [...state.missions].map((id) => ({ mission_id: id, completed_at: AT }));
    }
    if (text.startsWith("with prev as")) {
      const id = values[1] as string;
      const was = state.done.has(id);
      if (values[3] === true) state.done.add(id);
      return [{ best_score: values[2], completed_at: values[3] === true || was ? AT : null, was_completed: was }];
    }
    if (text.includes("from public.payment_security")) return w.pin ? [{ ok: 1 }] : [];
    if (text.includes("from public.payments where from_wallet")) return w.payment ? [{ ok: 1 }] : [];
    if (text.includes("from public.vaquita_contributions where contributor_id")) return w.contribution ? [{ ok: 1 }] : [];
    if (text.startsWith("insert into public.academia_missions")) {
      const id = values[1] as string;
      if (state.missions.has(id)) return [];
      state.missions.add(id);
      return [{ mission_id: id }];
    }
    if (text.includes("json_build_object") && text.includes("academia_progress")) {
      return [{ profile: { id: aliceId, username: "alice", display_name: "Alice", avatar_seed: null, avatar_style: null }, lessons_completed: 5, missions_completed: 1 }];
    }
    return [];
  });
  return { calls, state };
}

test(
  "GET /api/academia/lessons: sesión y lista con mi progreso",
  withApiEnv(async () => {
    world();
    assert.equal((await lessonsGet(req("/x", "GET", undefined, false))).status, 401);
    world({ done: ["que-es-stellar"] });
    const res = await lessonsGet(req("/x", "GET"));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { lessons: Array<{ id: string; completed: boolean; question_count: number }>; summary: { xp: number; badges: Array<{ id: string; earned: boolean }> } };
    assert.equal(body.lessons.length, 5);
    assert.equal(body.lessons[0].completed, true);
    assert.equal(body.lessons[1].completed, false);
    assert.equal(body.summary.xp, 50);
    assert.equal(body.summary.badges.find((b) => b.id === "primeros-pasos")?.earned, true);
  }),
);

test(
  "GET /api/academia/lessons/[id]: texto y preguntas SIN la correcta",
  withApiEnv(async () => {
    world();
    const res = await lessonGet(req("/x", "GET"), idCtx("cuentas-y-claves"));
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.doesNotMatch(text, /"correct"/);
    const target = getLesson("cuentas-y-claves")!;
    for (const q of target.questions) assert.equal(text.includes(q.explanation), false);
    const body = JSON.parse(text) as { lesson: { questions: Array<{ options: string[] }>; paragraphs: string[] } };
    assert.equal(body.lesson.questions.length, 4);
    assert.equal(body.lesson.questions[0].options.length, 4);

    assert.equal((await lessonGet(req("/x", "GET"), idCtx("no-existe"))).status, 404);
    assert.equal((await lessonGet(req("/x", "GET", undefined, false), idCtx("cuentas-y-claves"))).status, 401);
  }),
);

test(
  "POST /api/academia/lessons/[id]/answers: corrige en el servidor y da 50 XP una sola vez",
  withApiEnv(async () => {
    const target = getLesson("que-es-stellar")!;
    const good = target.questions.map((q) => q.correct as number);
    const { calls, state } = world();

    const first = await answersPost(req("/x", "POST", { answers: good }), idCtx(target.id));
    assert.equal(first.status, 200);
    const a = (await first.json()) as { score: number; passed: boolean; xp_earned: number; corrections: Array<{ correct: number; explanation: string }>; summary: { xp: number }; new_badges: string[] };
    assert.equal(a.score, 4);
    assert.equal(a.passed, true);
    assert.equal(a.xp_earned, 50);
    assert.equal(a.summary.xp, 50);
    assert.deepEqual(a.new_badges, ["primeros-pasos"]);
    assert.deepEqual(a.corrections.map((c) => c.correct), good);
    assert.ok(a.corrections.every((c) => c.explanation.length > 0));
    // La sesión es quien aprende, no el cuerpo.
    const attempt = calls.find((c) => c.text.startsWith("with prev as"));
    assert.deepEqual(attempt?.values, [aliceId, target.id, 4, true]);
    assert.ok(state.done.has(target.id));

    // Repetir la misma lección ya no da XP.
    const second = await answersPost(req("/x", "POST", { answers: good }), idCtx(target.id));
    const b = (await second.json()) as { xp_earned: number; passed: boolean; new_badges: string[] };
    assert.equal(b.passed, true);
    assert.equal(b.xp_earned, 0);
    assert.deepEqual(b.new_badges, []);
  }),
);

test(
  "POST answers: con menos de 3 correctas no se completa ni da XP; entradas malas son 400",
  withApiEnv(async () => {
    const target = getLesson("xlm-y-usdc")!;
    const wrong = target.questions.map((q) => ((q.correct + 1) % 4));
    const { state } = world();
    const res = await answersPost(req("/x", "POST", { answers: wrong }), idCtx(target.id));
    const body = (await res.json()) as { score: number; passed: boolean; xp_earned: number };
    assert.equal(body.score, 0);
    assert.equal(body.passed, false);
    assert.equal(body.xp_earned, 0);
    assert.equal(state.done.size, 0);

    for (const bad of [{ answers: [0, 1] }, { answers: [0, 1, 2, 9] }, { answers: "x" }, {}]) {
      assert.equal((await answersPost(req("/x", "POST", bad), idCtx(target.id))).status, 400, JSON.stringify(bad));
    }
    assert.equal((await answersPost(req("/x", "POST", { answers: [0, 0, 0, 0] }), idCtx("nada"))).status, 404);
    assert.equal((await answersPost(req("/x", "POST", { answers: [0, 0, 0, 0] }, false), idCtx(target.id))).status, 401);
  }),
);

test(
  "GET /api/academia/missions: verifica con datos reales y otorga una sola vez",
  withApiEnv(async () => {
    world({ pin: false, payment: false, contribution: false });
    assert.equal((await missionsGet(req("/x", "GET", undefined, false))).status, 401);
    const none = (await (await missionsGet(req("/x", "GET"))).json()) as { missions: Array<{ completed: boolean }>; newly_completed: string[]; summary: { xp: number } };
    assert.equal(none.missions.length, 3);
    assert.ok(none.missions.every((m) => !m.completed));
    assert.deepEqual(none.newly_completed, []);
    assert.equal(none.summary.xp, 0);

    const { calls, state } = world({ pin: true, payment: true });
    const some = (await (await missionsGet(req("/x", "GET"))).json()) as { missions: Array<{ id: string; completed: boolean }>; newly_completed: string[]; summary: { xp: number } };
    assert.deepEqual(some.newly_completed, ["crear-pin", "primer-pago"]);
    assert.deepEqual(some.missions.filter((m) => m.completed).map((m) => m.id), ["crear-pin", "primer-pago"]);
    assert.equal(some.summary.xp, 200);
    // La wallet sale de la sesión.
    assert.deepEqual(calls.find((c) => c.text.includes("from public.payments where from_wallet"))?.values, [ALICE]);
    assert.deepEqual(calls.find((c) => c.text.includes("payment_security"))?.values, [aliceId]);
    assert.equal(state.missions.size, 2);

    // Consultar otra vez no vuelve a otorgar.
    const again = (await (await missionsGet(req("/x", "GET"))).json()) as { newly_completed: string[]; summary: { xp: number } };
    assert.deepEqual(again.newly_completed, []);
    assert.equal(again.summary.xp, 200);
  }),
);

test(
  "misión de la vaquita: solo con un aporte real; las tres dan la insignia",
  withApiEnv(async () => {
    world({ contribution: true, missions: ["crear-pin", "primer-pago"], done: LESSONS.map((l) => l.id) });
    const res = (await (await missionsGet(req("/x", "GET"))).json()) as { newly_completed: string[]; summary: { xp: number; badges: Array<{ id: string; earned: boolean }> } };
    assert.deepEqual(res.newly_completed, ["aportar-vaquita"]);
    assert.equal(res.summary.xp, 5 * 50 + 3 * 100);
    assert.ok(res.summary.badges.every((b) => b.earned));
  }),
);

test(
  "GET /api/communities/[slug]/academia/ranking: solo miembros",
  withApiEnv(async () => {
    const { calls } = world();
    const ok = await rankingGet(req("/x", "GET"), slugCtx("kosmo"));
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { ranking: Array<{ xp: number; badges: string[] }> };
    assert.equal(body.ranking[0].xp, 5 * 50 + 100);
    assert.deepEqual(body.ranking[0].badges, ["primeros-pasos", "conoce-stellar"]);
    assert.deepEqual(calls.find((c) => c.text.includes("json_build_object"))?.values, [COMMUNITY_ID, 50, 50, 100]);

    world({ role: null });
    const outsider = await rankingGet(req("/x", "GET"), slugCtx("kosmo"));
    assert.equal(outsider.status, 403);
    assert.equal(((await outsider.json()) as { code: string }).code, "not_member");
    assert.equal((await rankingGet(req("/x", "GET", undefined, false), slugCtx("kosmo"))).status, 401);
  }),
);
