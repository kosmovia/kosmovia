/**
 * Mini-apps (migración 0013): catálogo y permisos del servidor, validación del appId,
 * el SQL, la migración, las rutas /api/miniapps/connections con un pool falso y la
 * lógica pura del host (qué se responde a cada mensaje según conexión y permisos).
 * Sin red ni base de datos.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";
import { Keypair } from "@stellar/stellar-base";

import { DELETE as connectionDelete } from "../app/api/miniapps/connections/[appId]/route.ts";
import { GET as connectionsGet, POST as connectionsPost } from "../app/api/miniapps/connections/route.ts";
import { MINI_APPS, isOpenable } from "../components/apps/registry.ts";
import { resetApiLimits } from "../lib/core/api-limits.ts";
import * as miniappsSql from "../lib/core/db/miniapps-sql.ts";
import { profileIdFromWallet } from "../lib/core/ids.ts";
import { MINIAPP_CATALOG, isAppIdFormat, parseAppId, serverPermissions } from "../lib/core/miniapps.ts";
import { hashPin } from "../lib/core/pin.ts";
import { SESSION_COOKIE, signSessionCookie } from "../lib/core/session-cookie.ts";
import {
  SANDBOX_FIRST_PARTY,
  SANDBOX_THIRD_PARTY,
  buildContext,
  connectionCovers,
  decideRequest,
  errorResponse,
  frameConfig,
  isKnownMethod,
  isTrustedSender,
  okResponse,
  parsePaymentRequest,
  parseShareText,
  permissionLines,
  toMiniAppUser,
  type HostState,
} from "../lib/miniapp-sdk/host.ts";
import { KV_PROTOCOL, isRequestMessage, type MiniAppPermission } from "../lib/miniapp-sdk/protocol.ts";

const SECRET = randomBytes(24).toString("hex");
const SECRET_BYTES = Buffer.from(SECRET);
const GOOD_PIN = "482916";
const ALICE = Keypair.random().publicKey();
const aliceId = profileIdFromWallet(ALICE);
const BOB_WALLET = Keypair.random().publicKey();

// ------------------------------------------------------------ catálogo del servidor y appId

test("parseAppId: una app del catálogo pasa", () => {
  const check = parseAppId("vaquita");
  assert.ok(check.ok);
  assert.equal(check.appId, "vaquita");
  assert.deepEqual([...check.app.permissions], ["perfil", "pagos", "mensajes"]);
});

test("parseAppId: formato inválido -> invalid_app (nada que se parezca a un id)", () => {
  const bad: unknown[] = [
    "", "a", "Vaquita", "VAQUITA", "vaquita ", " vaquita", "vaquita\n", "1vaquita", "-vaquita", "va_quita", "va.quita", "../vaquita",
    "vaquita/../x", "vaquita;drop table x", "a".repeat(33), "vaquita'--", "va\u0000quita", "vaquitá",
    null, undefined, 5, {}, ["vaquita"], true,
  ];
  for (const value of bad) {
    const check = parseAppId(value);
    assert.ok(!check.ok && check.code === "invalid_app", JSON.stringify(value));
  }
});

test("parseAppId: bien formado pero fuera del catálogo -> unknown_app (también los nombres de Object.prototype)", () => {
  for (const id of ["pasanaku", "otra-app", "constructor", "valueof", "hasownproperty", "proto"]) {
    const check = parseAppId(id);
    assert.ok(!check.ok && check.code === "unknown_app", id);
  }
});

test("isAppIdFormat: solo mira el formato (se puede desconectar una app que ya salió del catálogo)", () => {
  assert.equal(isAppIdFormat("vaquita"), true);
  assert.equal(isAppIdFormat("app-vieja-2"), true);
  assert.equal(isAppIdFormat("../x"), false);
  assert.equal(isAppIdFormat(7), false);
});

test("serverPermissions: salen del catálogo del servidor y la lista devuelta es una copia", () => {
  assert.deepEqual(serverPermissions("vaquita"), ["perfil", "pagos", "mensajes"]);
  assert.equal(serverPermissions("pasanaku"), null);
  const copy = serverPermissions("vaquita") as MiniAppPermission[];
  copy.push("perfil");
  copy.length = 0;
  assert.deepEqual(serverPermissions("vaquita"), ["perfil", "pagos", "mensajes"], "mutar la copia no cambia el catálogo");
});

test("registro de la interfaz: toda app con url está en el catálogo del servidor con los mismos permisos", () => {
  const withUrl = MINI_APPS.filter((app) => app.url);
  assert.ok(withUrl.length > 0);
  for (const app of withUrl) {
    const server = MINIAPP_CATALOG.find((s) => s.id === app.id);
    assert.ok(server, `${app.id} no está en el catálogo del servidor`);
    assert.deepEqual([...app.permissions].sort(), [...server.permissions].sort(), app.id);
    assert.ok(app.url?.startsWith("/"), "las apps oficiales van por ruta de Kosmovia");
  }
  // Y al revés: lo que el servidor conoce, la interfaz lo puede abrir.
  for (const server of MINIAPP_CATALOG) {
    const app = MINI_APPS.find((a) => a.id === server.id);
    assert.ok(app && isOpenable(app), server.id);
  }
});

test("registro: la Vaquita se abre en /miniapps/vaquita; las que no tienen url no se abren", () => {
  const vaquita = MINI_APPS.find((a) => a.id === "vaquita");
  assert.equal(vaquita?.url, "/miniapps/vaquita");
  assert.equal(isOpenable(vaquita!), true);
  assert.equal(isOpenable({ ...vaquita!, status: "en_revision" }), false);
  assert.equal(isOpenable({ ...vaquita!, url: undefined }), false);
  for (const app of MINI_APPS.filter((a) => a.status === "proximamente")) assert.equal(isOpenable(app), false, app.id);
});

// ------------------------------------------------------------ SQL y migración

test("SQL de conexiones: parametrizado, hostil solo viaja en values", () => {
  const hostile = "x'; drop table public.profiles; --";
  const list = miniappsSql.listMiniappConnections(hostile);
  const upsert = miniappsSql.upsertMiniappConnection(hostile, hostile, ["perfil"], 3);
  const revoke = miniappsSql.revokeMiniappConnection(hostile, hostile);
  for (const query of [list, upsert, revoke]) {
    assert.ok(!query.text.includes("drop table"), query.text);
    assert.ok(query.values.includes(hostile));
  }
  assert.match(list.text, /profile_id = \$1 and revoked_at is null/);
  assert.match(upsert.text, /on conflict \(profile_id, app_id\) where revoked_at is null/);
  assert.deepEqual(upsert.values, [hostile, hostile, ["perfil"], 3]);
  assert.match(revoke.text, /set revoked_at = now\(\)/);
  assert.match(revoke.text, /revoked_at is null/);
});

test("migración 0013: idempotente, índice único parcial y permisos conocidos", () => {
  const sql = readFileSync(new URL("../db/migrations/0013_miniapps.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.miniapp_connections/);
  assert.match(sql, /create unique index if not exists miniapp_connections_active_key[\s\S]*\(profile_id, app_id\) where revoked_at is null/);
  assert.match(sql, /create index if not exists/);
  for (const add of sql.match(/add constraint \w+/g) ?? []) {
    const name = add.replace("add constraint ", "");
    assert.ok(sql.includes(`drop constraint if exists ${name}`), name);
  }
  for (const column of ["profile_id", "app_id", "permissions", "pin_version", "created_at", "revoked_at"]) {
    assert.ok(sql.includes(column), column);
  }
  assert.ok(!/drop table|drop column|truncate|delete from/i.test(sql), "no borra nada");
});

// ------------------------------------------------------------ rutas (pool falso)

const POOL_KEY = Symbol.for("kosmovia.pg.pool");
type Call = { text: string; values: unknown[] };

const T = {
  lockPin: "select s.profile_id from public.payment_security s",
  activate: "with act as (",
  reserve: "update public.payment_security s set failed_attempts",
  clear: "update public.payment_security set failed_attempts = 0",
  status: "select (s.pin_hash is not null) as has_pin, to_char(",
  upsert: "insert into public.miniapp_connections",
  list: "select app_id, permissions",
  revoke: "update public.miniapp_connections set revoked_at",
};

interface World {
  stored?: { hash: string; salt: string };
  version?: number;
  lockedUntil?: string;
  connections?: unknown[];
  revoked?: boolean;
}

/** Pool falso con `query` y `connect` (checkPin usa una transacción). */
function installPool(world: World = {}): Call[] {
  const calls: Call[] = [];
  const version = world.version ?? 4;
  const handler = (text: string, values: unknown[]): unknown[] => {
    if (text.startsWith(T.lockPin)) return world.stored || world.lockedUntil ? [{ profile_id: aliceId }] : [];
    if (text.startsWith(T.activate)) return [];
    if (text.startsWith(T.reserve)) {
      if (!world.stored || world.lockedUntil) return [];
      return [{ pin_hash: world.stored.hash, pin_salt: world.stored.salt, pin_version: version, failed_attempts: 1, locked: false, locked_until: null }];
    }
    if (text.startsWith(T.status)) {
      if (!world.stored) return [];
      return [{ has_pin: true, locked_until: world.lockedUntil ?? null, pending_pin_at: null, daily_limit_usdc: "100.0000000", daily_limit_xlm: "1000.0000000" }];
    }
    if (text.startsWith(T.upsert)) {
      return [{ app_id: values[1], permissions: values[2], created_at: "2026-10-09T12:00:00.000000Z" }];
    }
    if (text.startsWith(T.list)) return world.connections ?? [];
    if (text.startsWith(T.revoke)) return world.revoked ? [{ app_id: values[1] }] : [];
    return [];
  };
  const client = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values: values ?? [] });
      return { rows: handler(text, values ?? []) };
    },
    release() {},
  };
  (globalThis as Record<symbol, unknown>)[POOL_KEY] = {
    query: (text: string, values?: unknown[]) => client.query(text, values),
    async connect() {
      return client;
    },
  };
  return calls;
}

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[POOL_KEY];
  resetApiLimits();
});

const API_ENV = { KOSMOVIA_DATA_BACKEND: "api", DATABASE_URL: "postgresql://u:p@localhost:5432/test", SESSION_SECRET: SECRET };

function withApiEnv(fn: () => Promise<void>, env: Record<string, string | undefined> = API_ENV) {
  return async () => {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(env)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
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

const sessionCookie = () => `${SESSION_COOKIE}=${signSessionCookie({ secret: SECRET_BYTES, wallet: ALICE, now: Date.now() }).token}`;

function req(path: string, method: string, body?: unknown, cookie: string | null = sessionCookie()): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://kosmovia.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

const has = (calls: Call[], fragment: string) => calls.some((c) => c.text.includes(fragment));
const queryOf = (calls: Call[], fragment: string) => calls.find((c) => c.text.includes(fragment));
const storedPin = () => hashPin(GOOD_PIN, SECRET_BYTES);
const idCtx = (appId: string) => ({ params: Promise.resolve({ appId }) });

test(
  "GET /api/miniapps/connections: pide sesión, sin base falla claro y devuelve las conexiones activas",
  withApiEnv(async () => {
    installPool();
    assert.equal((await connectionsGet(req("/api/miniapps/connections", "GET", undefined, null))).status, 401);

    const calls = installPool({
      connections: [{ app_id: "vaquita", permissions: ["perfil", "pagos", "mensajes", "ajeno"], created_at: "2026-10-09T12:00:00.000000Z" }],
    });
    const res = await connectionsGet(req("/api/miniapps/connections", "GET"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    // Solo permisos conocidos, y la consulta va con el perfil de la sesión.
    assert.deepEqual(await res.json(), {
      connections: [{ appId: "vaquita", permissions: ["perfil", "pagos", "mensajes"], createdAt: "2026-10-09T12:00:00.000000Z" }],
    });
    assert.deepEqual(queryOf(calls, T.list)?.values, [aliceId]);
  }),
);

test(
  "GET sin DATABASE_URL: 503 db_not_configured (sin pool)",
  withApiEnv(
    async () => {
      const res = await connectionsGet(req("/api/miniapps/connections", "GET"));
      assert.equal(res.status, 503);
      assert.equal(((await res.json()) as { code: string }).code, "db_not_configured");
    },
    { ...API_ENV, DATABASE_URL: undefined },
  ),
);

test(
  "POST: PIN correcto -> 201 y la conexión se guarda con los permisos del SERVIDOR, aunque el cliente mande otros",
  withApiEnv(async () => {
    const calls = installPool({ stored: await storedPin(), version: 7 });
    const res = await connectionsPost(
      req("/api/miniapps/connections", "POST", { appId: "vaquita", pin: GOOD_PIN, permissions: ["perfil"], pinVersion: 99, profileId: "otro" }),
    );
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), {
      connection: { appId: "vaquita", permissions: ["perfil", "pagos", "mensajes"], createdAt: "2026-10-09T12:00:00.000000Z" },
    });
    const upsert = queryOf(calls, T.upsert);
    assert.ok(upsert);
    // perfil de la sesión, app, permisos del catálogo y la versión del PIN verificada (no la del cuerpo).
    assert.deepEqual(upsert.values, [aliceId, "vaquita", ["perfil", "pagos", "mensajes"], 7]);
    // El PIN se verificó ANTES de guardar, en la misma transacción de siempre.
    const iPin = calls.findIndex((c) => c.text.startsWith(T.reserve));
    const iSave = calls.findIndex((c) => c.text.startsWith(T.upsert));
    assert.ok(iPin >= 0 && iPin < iSave);
    assert.ok(has(calls, T.clear), "un acierto limpia los fallos");
  }),
);

test(
  "POST: PIN incorrecto -> 422 con intentos que quedan y NO se guarda nada",
  withApiEnv(async () => {
    const calls = installPool({ stored: await storedPin() });
    const res = await connectionsPost(req("/api/miniapps/connections", "POST", { appId: "vaquita", pin: "999111" }));
    assert.equal(res.status, 422);
    const body = (await res.json()) as { code: string; attemptsLeft: number };
    assert.equal(body.code, "wrong_pin");
    assert.equal(typeof body.attemptsLeft, "number");
    assert.ok(!has(calls, T.upsert));
  }),
);

test(
  "POST: bloqueado -> 423 sin guardar; sin PIN creado -> 409 no_pin",
  withApiEnv(async () => {
    const until = new Date(Date.now() + 60_000).toISOString();
    const locked = installPool({ stored: await storedPin(), lockedUntil: until });
    const res = await connectionsPost(req("/api/miniapps/connections", "POST", { appId: "vaquita", pin: GOOD_PIN }));
    assert.equal(res.status, 423);
    assert.equal(((await res.json()) as { code: string }).code, "locked");
    assert.ok(!has(locked, T.upsert));

    const none = installPool({});
    const res2 = await connectionsPost(req("/api/miniapps/connections", "POST", { appId: "vaquita", pin: GOOD_PIN }));
    assert.equal(res2.status, 409);
    assert.equal(((await res2.json()) as { code: string }).code, "no_pin");
    assert.ok(!has(none, T.upsert));
  }),
);

test(
  "POST: appId inválido o desconocido se rechaza ANTES de tocar la base (no gasta un intento del PIN)",
  withApiEnv(async () => {
    const calls = installPool({ stored: await storedPin() });
    const invalid = await connectionsPost(req("/api/miniapps/connections", "POST", { appId: "../vaquita", pin: GOOD_PIN }));
    assert.equal(invalid.status, 400);
    assert.equal(((await invalid.json()) as { code: string }).code, "invalid_app");
    const missing = await connectionsPost(req("/api/miniapps/connections", "POST", { pin: GOOD_PIN }));
    assert.equal(missing.status, 400);
    const unknown = await connectionsPost(req("/api/miniapps/connections", "POST", { appId: "pasanaku", pin: GOOD_PIN }));
    assert.equal(unknown.status, 404);
    assert.equal(((await unknown.json()) as { code: string }).code, "unknown_app");
    assert.equal(calls.length, 0, "ni una sentencia");
  }),
);

test(
  "POST: PIN con mal formato -> 400 invalid_pin sin base; sin sesión -> 401; cuerpo que no es objeto -> 400",
  withApiEnv(async () => {
    const calls = installPool({ stored: await storedPin() });
    for (const pin of ["12345", "1234567", "abcdef", 482916, null, undefined]) {
      const res = await connectionsPost(req("/api/miniapps/connections", "POST", { appId: "vaquita", pin }));
      assert.equal(res.status, 400, String(pin));
      assert.equal(((await res.json()) as { code: string }).code, "invalid_pin");
    }
    assert.equal((await connectionsPost(req("/api/miniapps/connections", "POST", { appId: "vaquita", pin: GOOD_PIN }, null))).status, 401);
    assert.equal((await connectionsPost(req("/api/miniapps/connections", "POST", ["vaquita"]))).status, 400);
    assert.equal(calls.length, 0);
  }),
);

test(
  "POST usa el mismo freno por perfil que el PIN (pinAttempt): el pedido 11 en un minuto es 429",
  withApiEnv(async () => {
    installPool({ stored: await storedPin() });
    let last = 0;
    for (let i = 0; i < 11; i += 1) {
      last = (await connectionsPost(req("/api/miniapps/connections", "POST", { appId: "pasanaku", pin: GOOD_PIN }))).status;
      if (i < 10) assert.equal(last, 404, `pedido ${i + 1}`);
    }
    assert.equal(last, 429);
  }),
);

test(
  "DELETE /api/miniapps/connections/[appId]: revoca con el perfil de la sesión y responde 204 (también si no estaba conectada)",
  withApiEnv(async () => {
    const calls = installPool({ revoked: true });
    const res = await connectionDelete(req("/api/miniapps/connections/vaquita", "DELETE"), idCtx("vaquita"));
    assert.equal(res.status, 204);
    assert.deepEqual(queryOf(calls, T.revoke)?.values, [aliceId, "vaquita"]);

    installPool({ revoked: false });
    assert.equal((await connectionDelete(req("/api/miniapps/connections/vaquita", "DELETE"), idCtx("vaquita"))).status, 204);
    // Una app que ya salió del catálogo también se puede desconectar.
    assert.equal((await connectionDelete(req("/api/miniapps/connections/app-vieja", "DELETE"), idCtx("app-vieja"))).status, 204);
  }),
);

test(
  "DELETE: sin sesión 401; appId con mal formato 400 sin base",
  withApiEnv(async () => {
    const calls = installPool();
    assert.equal((await connectionDelete(req("/api/miniapps/connections/vaquita", "DELETE", undefined, null), idCtx("vaquita"))).status, 401);
    for (const bad of ["../x", "Vaquita", "a", "va quita", "x".repeat(40)]) {
      const res = await connectionDelete(req("/api/miniapps/connections/x", "DELETE"), idCtx(bad));
      assert.equal(res.status, 400, bad);
    }
    assert.equal(calls.length, 0);
  }),
);

// ------------------------------------------------------------ host: mensajes, iframe y origen

const ALL: MiniAppPermission[] = ["perfil", "pagos", "mensajes"];
const connected = (permissions: MiniAppPermission[] = ALL): HostState => ({ appPermissions: ALL, connection: { permissions }, hasChannel: true });
const notConnected: HostState = { appPermissions: ALL, connection: null, hasChannel: true };
const GOOD_PAY = { to: "@sofia", amount: 0.5, asset: "USDC", note: "Aporte a Asado" };

test("isRequestMessage / isKnownMethod: solo se atiende el protocolo", () => {
  assert.equal(isRequestMessage({ protocol: KV_PROTOCOL, id: "1", method: "ready", params: undefined }), true);
  for (const junk of [null, undefined, "ready", 5, {}, { id: "1", method: "ready" }, { protocol: "otro/1", id: "1", method: "ready" }, { protocol: KV_PROTOCOL, method: "ready" }]) {
    assert.equal(isRequestMessage(junk), false, JSON.stringify(junk));
  }
  assert.equal(isKnownMethod("requestPayment"), true);
  assert.equal(isKnownMethod("sendEverything"), false);
  assert.equal(isKnownMethod("__proto__"), false);
});

test("decideRequest: ready y close no piden nada; un método desconocido es invalid_params", () => {
  assert.deepEqual(decideRequest({ method: "ready", params: undefined }, notConnected), { action: "ready" });
  assert.deepEqual(decideRequest({ method: "close", params: undefined }, notConnected), { action: "close" });
  const unknown = decideRequest({ method: "drain" as never, params: undefined }, connected());
  assert.deepEqual(unknown, { action: "error", code: "invalid_params", message: "Ese método no existe." });
});

test("decideRequest: connect abre la hoja si no hay conexión y responde directo si ya la hay", () => {
  assert.deepEqual(decideRequest({ method: "connect", params: undefined }, notConnected), { action: "connect" });
  assert.deepEqual(decideRequest({ method: "connect", params: undefined }, connected()), { action: "connected" });
});

test("decideRequest: si el catálogo le sumó un permiso después de conectar, vuelve a pedir conexión (PIN)", () => {
  const old = connected(["perfil", "pagos"]);
  assert.equal(connectionCovers(old.connection, ALL), false);
  assert.deepEqual(decideRequest({ method: "connect", params: undefined }, old), { action: "connect" });
  const err = decideRequest({ method: "getUser", params: undefined }, old);
  assert.ok(err.action === "error" && err.code === "not_connected");
  assert.equal(connectionCovers({ permissions: ALL }, ["perfil"]), true);
  assert.equal(connectionCovers(null, []), false);
});

test("decideRequest: getUser, requestPayment y share exigen conexión (not_connected)", () => {
  for (const [method, params] of [["getUser", undefined], ["requestPayment", GOOD_PAY], ["share", { text: "hola" }]] as const) {
    const decision = decideRequest({ method, params } as never, notConnected);
    assert.ok(decision.action === "error" && decision.code === "not_connected", method);
  }
  assert.deepEqual(decideRequest({ method: "getUser", params: undefined }, connected()), { action: "user" });
});

test("decideRequest: requestPayment pide permiso pagos -> si falta, permission_denied", () => {
  const noPay: HostState = { appPermissions: ["perfil", "mensajes"], connection: { permissions: ["perfil", "mensajes"] }, hasChannel: true };
  const denied = decideRequest({ method: "requestPayment", params: GOOD_PAY } as never, noPay);
  assert.ok(denied.action === "error" && denied.code === "permission_denied");
  const ok = decideRequest({ method: "requestPayment", params: GOOD_PAY } as never, connected());
  assert.deepEqual(ok, { action: "pay", payment: { to: "@sofia", amount: 0.5, asset: "USDC", note: "Aporte a Asado" } });
});

test("decideRequest: share pide permiso mensajes y un canal abierto", () => {
  const noMsg: HostState = { appPermissions: ["perfil", "pagos"], connection: { permissions: ["perfil", "pagos"] }, hasChannel: true };
  const denied = decideRequest({ method: "share", params: { text: "hola" } } as never, noMsg);
  assert.ok(denied.action === "error" && denied.code === "permission_denied");
  assert.deepEqual(decideRequest({ method: "share", params: { text: "  hola  " } } as never, connected()), { action: "share", text: "hola" });
  const noChannel = decideRequest({ method: "share", params: { text: "hola" } } as never, { ...connected(), hasChannel: false });
  assert.ok(noChannel.action === "error" && noChannel.code === "unknown");
  const empty = decideRequest({ method: "share", params: { text: "   " } } as never, connected());
  assert.ok(empty.action === "error" && empty.code === "invalid_params");
});

test("la app no puede darse permisos: solo cuenta lo que dice el catálogo Y lo que la persona autorizó", () => {
  // La conexión trae pagos, pero el catálogo de esa app ya no.
  const state: HostState = { appPermissions: ["perfil"], connection: { permissions: ["perfil", "pagos"] }, hasChannel: true };
  const decision = decideRequest({ method: "requestPayment", params: GOOD_PAY } as never, state);
  assert.ok(decision.action === "error" && decision.code === "permission_denied");
});

test("parsePaymentRequest: valida destinatario, USDC, monto (7 decimales máx) y limpia la nota", () => {
  const ok = parsePaymentRequest({ to: " @sofia_99 ", amount: 12.5, asset: "USDC" });
  assert.deepEqual(ok, { ok: true, payment: { to: "@sofia_99", amount: 12.5, asset: "USDC" } });
  assert.ok(parsePaymentRequest({ to: BOB_WALLET, amount: 1, asset: "USDC" }).ok);
  assert.ok(parsePaymentRequest({ to: "sofia", amount: 1, asset: "USDC" }).ok, "@usuario sin la arroba");

  const note = parsePaymentRequest({ to: "@sofia", amount: 1, asset: "USDC", note: "  Aporte\nal asado\u0000 " });
  assert.ok(note.ok && note.payment.note === "Aporte al asado");
  const longNote = parsePaymentRequest({ to: "@sofia", amount: 1, asset: "USDC", note: "x".repeat(500) });
  assert.ok(longNote.ok && (longNote.payment.note ?? "").length === 140);

  const bad: unknown[] = [
    null, undefined, "pago", [], {},
    { to: 5, amount: 1, asset: "USDC" },
    { to: "", amount: 1, asset: "USDC" },
    { to: "@so", amount: 1, asset: "USDC" },
    { to: "@sofia rojas", amount: 1, asset: "USDC" },
    { to: `G${"1".repeat(55)}`, amount: 1, asset: "USDC" },
    { to: "@sofia", amount: 1, asset: "XLM" },
    { to: "@sofia", amount: 1 },
    { to: "@sofia", amount: "1", asset: "USDC" },
    { to: "@sofia", amount: 0, asset: "USDC" },
    { to: "@sofia", amount: -3, asset: "USDC" },
    { to: "@sofia", amount: 0.001, asset: "USDC" },
    { to: "@sofia", amount: 1e9, asset: "USDC" },
    { to: "@sofia", amount: Number.NaN, asset: "USDC" },
    { to: "@sofia", amount: Number.POSITIVE_INFINITY, asset: "USDC" },
    { to: "@sofia", amount: 0.1 + 0.2, asset: "USDC" },
    { to: "@sofia", amount: 1, asset: "USDC", note: { x: 1 } },
  ];
  for (const params of bad) {
    const check = parsePaymentRequest(params);
    assert.equal(check.ok, false, JSON.stringify(params));
  }
});

test("parseShareText: texto, sin vacío, tope de un mensaje", () => {
  assert.deepEqual(parseShareText({ text: " Únete a la vaquita " }), { ok: true, text: "Únete a la vaquita" });
  assert.ok(parseShareText({ text: "x".repeat(2000) }).ok);
  for (const bad of [null, "hola", [], {}, { text: 5 }, { text: "" }, { text: "  \n " }, { text: "x".repeat(2001) }]) {
    assert.equal(parseShareText(bad).ok, false, JSON.stringify(bad));
  }
});

test("frameConfig: la app oficial va por ruta, mismo origen y sandbox completo; una de otro origen, sin allow-same-origin", () => {
  const host = "https://kosmovia.test";
  const own = frameConfig("/miniapps/vaquita", host);
  assert.ok(own);
  assert.equal(own.src, "https://kosmovia.test/miniapps/vaquita");
  assert.equal(own.expectedOrigin, "https://kosmovia.test");
  assert.equal(own.sandbox, SANDBOX_FIRST_PARTY);
  assert.equal(own.sandbox, "allow-scripts allow-forms allow-same-origin allow-popups");
  assert.equal(own.sameOrigin, true);

  const third = frameConfig("https://app.ejemplo.com/inicio", host);
  assert.ok(third);
  assert.equal(third.sameOrigin, false);
  assert.equal(third.sandbox, SANDBOX_THIRD_PARTY);
  assert.ok(!third.sandbox.includes("allow-same-origin"));
  assert.equal(third.expectedOrigin, "null", "un iframe sin same-origin manda mensajes con origen opaco");

  assert.equal(frameConfig("javascript:alert(1)", host), null);
  assert.equal(frameConfig("data:text/html,<script>1</script>", host), null);
  assert.equal(frameConfig("ftp://x.test/a", host), null);
});

test("isTrustedSender: exige el iframe correcto Y el origen esperado", () => {
  const expectedOrigin = "https://kosmovia.test";
  assert.equal(isTrustedSender({ fromFrame: true, origin: expectedOrigin, expectedOrigin }), true);
  assert.equal(isTrustedSender({ fromFrame: false, origin: expectedOrigin, expectedOrigin }), false, "otra ventana, aunque tenga el origen");
  assert.equal(isTrustedSender({ fromFrame: true, origin: "https://evil.test", expectedOrigin }), false);
  assert.equal(isTrustedSender({ fromFrame: true, origin: "null", expectedOrigin }), false);
  assert.equal(isTrustedSender({ fromFrame: true, origin: "null", expectedOrigin: "null" }), true, "app de terceros sin same-origin");
});

test("toMiniAppUser: solo los campos públicos, nunca el resto del usuario", () => {
  const full = {
    id: "u1",
    username: "@sofia",
    displayName: "Sofía Rojas",
    avatar: "data:image/svg+xml;utf8,x",
    wallet: BOB_WALLET,
    // Campos que NO deben pasar:
    bio: "privado",
    role: "owner",
    xHandle: "sofia",
  };
  const user = toMiniAppUser(full);
  assert.deepEqual(Object.keys(user).sort(), ["avatar", "displayName", "id", "username", "wallet"]);
  assert.equal(user.wallet, BOB_WALLET);
  assert.equal(toMiniAppUser({ id: "u2", username: "@a", displayName: "A" }).avatar, null);
  assert.equal(toMiniAppUser({ id: "u2", username: "@a", displayName: "A" }).wallet, "");
});

test("buildContext: comunidad, canal, tema y solo parámetros de texto", () => {
  const ctx = buildContext({
    community: { id: "c1", slug: "stellar-bolivia", name: "Stellar Elite Bolivia", /* extra */ ...({ members: [1, 2] } as object) } as never,
    channel: { id: "ch1", name: "general", ...({ topic: "x" } as object) } as never,
    theme: "negro",
    params: { vaquitaId: "abc", otro: 5, objeto: { a: 1 } },
  });
  assert.deepEqual(ctx, {
    community: { id: "c1", slug: "stellar-bolivia", name: "Stellar Elite Bolivia" },
    channel: { id: "ch1", name: "general" },
    theme: "negro",
    params: { vaquitaId: "abc" },
  });
  assert.deepEqual(buildContext({ community: null, channel: null, theme: "kosmovia" }), { community: null, channel: null, theme: "kosmovia", params: {} });
});

test("permissionLines: el texto de la hoja de conexión de Kosmovia", () => {
  assert.deepEqual(permissionLines(["perfil", "pagos", "mensajes"]), [
    "ver tu @usuario y perfil público",
    "pedirte pagos (siempre con tu PIN)",
    "publicar en el canal",
  ]);
  assert.deepEqual(permissionLines([]), []);
});

test("respuestas: okResponse / errorResponse siguen el protocolo", () => {
  assert.deepEqual(okResponse("7", { messageId: "m1" }), { protocol: KV_PROTOCOL, id: "7", ok: true, result: { messageId: "m1" } });
  assert.deepEqual(errorResponse("7", "user_rejected", "no"), { protocol: KV_PROTOCOL, id: "7", ok: false, error: { code: "user_rejected", message: "no" } });
});
