// Prueba de punta a punta del modo "api", a nivel HTTP y sin la UI de Pollar.
//
//   1. En una terminal:   npm run dev            (queda en http://localhost:3000)
//   2. En otra:           npm run smoke:api
//
// Variables (opcionales): SMOKE_BASE_URL (por defecto http://localhost:3000).
// Lee DATABASE_URL del entorno / .env.local SOLO para limpiar al final.
//
// Genera dos pares de claves Stellar DESECHABLES en memoria (nunca se guardan ni
// se imprimen), firma con ellas una prueba SEP-53 por cada wallet, pide la
// cookie de sesion y recorre: perfil, comunidad, mensajes, permisos. Al
// terminar borra de la base SOLO las filas creadas por estos dos perfiles de
// prueba (por su id), pase lo que pase. No toca fondos ni la red de Stellar.
//
// Imprime solo: paso, PASS/FAIL y estado HTTP. Ningun secreto, cookie ni dato de la base.

import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-base";
import pg from "pg";
import { authMessage, PROOF_HEADER } from "../lib/auth-message.ts";
import { describeConnectionError, readDbConfig } from "../lib/db/config.ts";
import { profileIdFromWallet } from "../lib/ids.ts";

const BASE = (process.env.SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const results = [];

function record(step, pass, detail = "") {
  results.push({ step, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${step}${detail ? `  (${detail})` : ""}`);
  return pass;
}

/** SEP-53: sha256("Stellar Signed Message:\n" + message), signed with the account key. */
function proofHeader(kp, method, path) {
  const exp = Date.now() + 60_000;
  const message = authMessage(kp.publicKey(), exp, method, path);
  const payload = Buffer.concat([Buffer.from("Stellar Signed Message:\n"), Buffer.from(message)]);
  const signature = kp.sign(createHash("sha256").update(payload).digest()).toString("base64");
  return JSON.stringify({ address: kp.publicKey(), exp, signature });
}

/** A tiny client that keeps one cookie, like a browser tab. */
function client(label) {
  let cookie = null;
  return {
    label,
    hasCookie: () => cookie !== null,
    setRawCookie: (value) => {
      cookie = value;
    },
    async call(method, path, { body, headers = {} } = {}) {
      const h = { ...headers };
      if (cookie) h.cookie = cookie;
      if (body !== undefined) h["content-type"] = "application/json";
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: h,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data, res };
    },
    async login(kp) {
      const { status, data, res } = await this.call("POST", "/api/auth/session", {
        headers: { [PROOF_HEADER]: proofHeader(kp, "POST", "/api/auth/session") },
      });
      const setCookie = res.headers.getSetCookie?.() ?? [];
      const session = setCookie.find((c) => c.startsWith("kosmovia_session="));
      if (session) cookie = session.split(";")[0];
      return { status, data, setCookie: session ?? "" };
    },
  };
}

async function cleanup(ids) {
  let config;
  try {
    config = readDbConfig();
  } catch {
    config = null;
  }
  if (!config) {
    console.log("LIMPIEZA  omitida: falta DATABASE_URL.");
    return false;
  }
  const db = new pg.Client(config);
  try {
    await db.connect();
    await db.query("begin");
    // Orden por las llaves foraneas: las comunidades de estos perfiles arrastran sus
    // miembros, canales y mensajes (cascade); despues lo que quede de ellos y sus perfiles.
    const out = {};
    out.messages_de_los_perfiles = (await db.query("delete from public.messages where author_id = any($1::uuid[])", [ids])).rowCount;
    out.comunidades = (await db.query("delete from public.communities where owner_id = any($1::uuid[])", [ids])).rowCount;
    out.miembros_restantes = (await db.query("delete from public.members where profile_id = any($1::uuid[])", [ids])).rowCount;
    out.perfiles = (await db.query("delete from public.profiles where id = any($1::uuid[])", [ids])).rowCount;
    await db.query("commit");
    console.log(`LIMPIEZA  filas borradas: ${JSON.stringify(out)}`);
    return true;
  } catch (err) {
    await db.query("rollback").catch(() => {});
    console.log(`LIMPIEZA  FALLO: ${describeConnectionError(err)}`);
    return false;
  } finally {
    await db.end().catch(() => {});
  }
}

const A = Keypair.random();
const B = Keypair.random();
const idA = profileIdFromWallet(A.publicKey());
const idB = profileIdFromWallet(B.publicKey());
const SLUG = "prueba-kosmovia";

try {
  console.log(`smoke:api  ${BASE}`);
  const a = client("A");
  const b = client("B");

  // 1. Session cookie.
  const login = await a.login(A);
  record(
    "1  POST /api/auth/session devuelve cookie httpOnly y sin token en el cuerpo",
    login.status === 200 &&
      login.data.backend === "api" &&
      login.data.profileId === idA &&
      login.data.token === undefined &&
      /HttpOnly/i.test(login.setCookie) &&
      /SameSite=Lax/i.test(login.setCookie),
    `HTTP ${login.status}`,
  );
  if (!a.hasCookie()) throw new Error("sin cookie de sesion: no se puede seguir (revisa el servidor y KOSMOVIA_DATA_BACKEND / SESSION_SECRET / DATABASE_URL)");

  // 2. No cookie, no access; a tampered cookie is refused.
  const anon = client("anon");
  const noCookie = await anon.call("GET", "/api/profile");
  record("2a GET /api/profile sin cookie es 401", noCookie.status === 401, `HTTP ${noCookie.status}`);
  const forged = client("forged");
  forged.setRawCookie("kosmovia_session=aaaa.bbbb.cccc");
  const forgedRes = await forged.call("GET", "/api/profile");
  record("2b cookie falsificada es 401", forgedRes.status === 401, `HTTP ${forgedRes.status}`);

  // 3. Profile.
  const before = await a.call("GET", "/api/profile");
  record("3a GET /api/profile antes de crear: perfil null", before.status === 200 && before.data.profile === null, `HTTP ${before.status}`);
  const created = await a.call("POST", "/api/profile", {
    body: { username: "@prueba_kosmo", displayName: "Prueba Kosmo", avatarSeed: "smoke:prueba", avatarStyle: "planet" },
  });
  record(
    "3b POST /api/profile crea @prueba_kosmo con avatar",
    created.status === 201 &&
      created.data.profile?.username === "prueba_kosmo" &&
      created.data.profile?.avatar_style === "planet" &&
      created.data.profile?.id === idA &&
      created.data.profile?.trust_level === 0,
    `HTTP ${created.status}`,
  );
  const again = await a.call("POST", "/api/profile", { body: { username: "prueba_kosmo" } });
  record("3c crear el perfil dos veces es 409", again.status === 409, `HTTP ${again.status}`);
  const sneaky = await a.call("PATCH", "/api/profile", { body: { trust_level: 2 } });
  record("3d no se puede subir trust_level desde el perfil (400)", sneaky.status === 400, `HTTP ${sneaky.status}`);
  const pub = await anon.call("GET", "/api/profiles/prueba_kosmo");
  record("3e GET /api/profiles/prueba_kosmo es publico", pub.status === 200 && pub.data.profile?.username === "prueba_kosmo", `HTTP ${pub.status}`);

  // 4. Community.
  const community = await a.call("POST", "/api/communities", {
    body: { name: "Prueba Kosmovia", slug: SLUG, description: "Comunidad de prueba (se borra sola)" },
  });
  record("4a POST /api/communities crea 'Prueba Kosmovia'", community.status === 201 && community.data.community?.owner_id === idA, `HTTP ${community.status}`);
  const detail = await a.call("GET", `/api/communities/${SLUG}`);
  record("4b el dueño queda como owner", detail.status === 200 && detail.data.myRole === "owner", `HTTP ${detail.status}`);
  const chans = await a.call("GET", `/api/communities/${SLUG}/channels`);
  const channels = chans.data.channels ?? [];
  const general = channels.find((c) => c.name === "general");
  const anuncios = channels.find((c) => c.name === "anuncios");
  record(
    "4c el trigger creó #general (text) y #anuncios (announcement)",
    chans.status === 200 && general?.type === "text" && anuncios?.type === "announcement",
    `HTTP ${chans.status}`,
  );
  if (!general || !anuncios) throw new Error("faltan los canales por defecto");

  // 5. Messages as the owner.
  const posted = await a.call("POST", `/api/channels/${general.id}/messages`, { body: { content: "Hola desde la prueba de humo", author_id: idB } });
  record(
    "5a POST mensaje en #general (el autor es la sesión, no el cuerpo)",
    posted.status === 201 && posted.data.message?.author_id === idA && posted.data.message?.author?.username === "prueba_kosmo",
    `HTTP ${posted.status}`,
  );
  const list = await a.call("GET", `/api/channels/${general.id}/messages`);
  const ids = (list.data.messages ?? []).map((m) => m.id);
  record("5b GET mensajes devuelve el mensaje, con autor", list.status === 200 && ids.includes(posted.data.message?.id), `HTTP ${list.status}`);
  const poll = await a.call("GET", `/api/channels/${general.id}/messages?after=${posted.data.message?.id}`);
  record("5c GET ?after= (polling) responde 200", poll.status === 200 && Array.isArray(poll.data.messages), `HTTP ${poll.status}`);
  const badCursor = await a.call("GET", `/api/channels/${general.id}/messages?after=no-es-un-uuid`);
  record("5d cursor inválido es 400", badCursor.status === 400, `HTTP ${badCursor.status}`);
  const announce = await a.call("POST", `/api/channels/${anuncios.id}/messages`, { body: { content: "Anuncio del owner" } });
  record("5e el owner sí puede escribir en #anuncios", announce.status === 201, `HTTP ${announce.status}`);

  // 6. A second wallet that is not a member.
  const loginB = await b.login(B);
  record("6a segunda wallet obtiene su cookie", loginB.status === 200 && loginB.data.profileId === idB, `HTTP ${loginB.status}`);
  const deniedRead = await b.call("GET", `/api/channels/${general.id}/messages`);
  record("6b un NO miembro no puede leer mensajes (403)", deniedRead.status === 403 && deniedRead.data.code === "not_member", `HTTP ${deniedRead.status}`);
  const deniedChans = await b.call("GET", `/api/communities/${SLUG}/channels`);
  record("6c un NO miembro no puede listar canales (403)", deniedChans.status === 403, `HTTP ${deniedChans.status}`);
  const deniedMembers = await b.call("GET", `/api/communities/${SLUG}/members`);
  record("6d un NO miembro no puede listar miembros (403)", deniedMembers.status === 403, `HTTP ${deniedMembers.status}`);
  const deniedPost = await b.call("POST", `/api/channels/${general.id}/messages`, { body: { content: "intruso" } });
  record("6e un NO miembro no puede escribir (403)", deniedPost.status === 403, `HTTP ${deniedPost.status}`);
  const publicView = await b.call("GET", `/api/communities/${SLUG}`);
  record("6f la comunidad es pública y myRole es null", publicView.status === 200 && publicView.data.myRole === null, `HTTP ${publicView.status}`);

  // 7. B joins as a plain member.
  const noProfileJoin = await b.call("POST", `/api/communities/${SLUG}/join`);
  record("7a unirse sin perfil falla con 409 no_profile", noProfileJoin.status === 409 && noProfileJoin.data.code === "no_profile", `HTTP ${noProfileJoin.status}`);
  const profileB = await b.call("POST", "/api/profile", { body: { username: "prueba_kosmo_b", displayName: "Prueba B", avatarSeed: "smoke:b", avatarStyle: "rocket" } });
  record("7b la segunda wallet crea su perfil", profileB.status === 201, `HTTP ${profileB.status}`);
  const join = await b.call("POST", `/api/communities/${SLUG}/join`);
  record("7c unirse como member", join.status === 200 && join.data.role === "member", `HTTP ${join.status}`);
  const nowRead = await b.call("GET", `/api/channels/${general.id}/messages`);
  record("7d ahora el miembro sí lee #general", nowRead.status === 200 && (nowRead.data.messages ?? []).length >= 1, `HTTP ${nowRead.status}`);
  const memberPost = await b.call("POST", `/api/channels/${general.id}/messages`, { body: { content: "Hola, soy un miembro" } });
  record("7e un miembro escribe en #general", memberPost.status === 201 && memberPost.data.message?.author_id === idB, `HTTP ${memberPost.status}`);
  const memberAnnounce = await b.call("POST", `/api/channels/${anuncios.id}/messages`, { body: { content: "intento de anuncio" } });
  record(
    "7f un miembro NO puede escribir en #anuncios (403)",
    memberAnnounce.status === 403 && memberAnnounce.data.code === "announcement_readonly",
    `HTTP ${memberAnnounce.status}`,
  );
  const memberChannel = await b.call("POST", `/api/communities/${SLUG}/channels`, { body: { name: "mio" } });
  record("7g un miembro NO puede crear canales (403)", memberChannel.status === 403, `HTTP ${memberChannel.status}`);
  const members = await a.call("GET", `/api/communities/${SLUG}/members`);
  record("7h el owner ve 2 miembros", members.status === 200 && (members.data.members ?? []).length === 2, `HTTP ${members.status}`);
  const ownerChannel = await a.call("POST", `/api/communities/${SLUG}/channels`, { body: { name: "ideas", topic: "Ideas" } });
  record("7i el owner crea un canal", ownerChannel.status === 201, `HTTP ${ownerChannel.status}`);

  // 8. Cross-site write and logout.
  const cross = await a.call("POST", `/api/channels/${general.id}/messages`, { body: { content: "x" }, headers: { origin: "https://evil.example" } });
  record("8a escritura con Origin ajeno es 403", cross.status === 403, `HTTP ${cross.status}`);
  const out = await a.call("POST", "/api/auth/logout");
  record("8b logout limpia la cookie", out.status === 200 && /Max-Age=0/i.test((out.res.headers.getSetCookie?.() ?? []).join(";")), `HTTP ${out.status}`);

} catch (err) {
  record("EJECUCION", false, err instanceof Error ? err.message : "error");
} finally {
  // Always: remove only what these two throwaway profiles created.
  const cleaned = await cleanup([idA, idB]);
  record("9  limpieza de las filas de prueba", cleaned);
}

const failed = results.filter((r) => !r.pass);
console.log(`\nsmoke:api  ${results.length - failed.length}/${results.length} pasos OK`);
process.exit(failed.length === 0 ? 0 : 1);
