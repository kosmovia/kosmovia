// Generador de avatares de Kosmovia. Puro y determinista: misma semilla + mismo estilo = mismo SVG.
// Solo importa ./kosmonautas.ts (corre directo bajo node --experimental-strip-types y bajo Next).
// Solo usa la paleta de la plataforma, con variaciones de opacidad.
// "kosmonauta" es el generador por rasgos (pixel art); los otros 7 quedan para perfiles viejos.

import { decodificar, svg as kosmonautaSvg } from "./kosmonautas.ts";

export const AVATAR_STYLES = [
  "astronaut",
  "planet",
  "constellation",
  "rocket",
  "nebula",
  "portal",
  "eclipse",
  "kosmonauta",
] as const;

export type AvatarStyle = (typeof AVATAR_STYLES)[number];

type LegacyStyle = Exclude<AvatarStyle, "kosmonauta">;

/** Los 7 estilos del primer generador (semilla + estilo). */
export const LEGACY_AVATAR_STYLES = AVATAR_STYLES.filter((s): s is LegacyStyle => s !== "kosmonauta");

export const AVATAR_STYLE_LABELS: Record<AvatarStyle, string> = {
  astronaut: "Astronauta",
  planet: "Planeta con anillos",
  constellation: "Constelación",
  rocket: "Cohete",
  nebula: "Nebulosa",
  portal: "Portal",
  eclipse: "Eclipse",
  kosmonauta: "Kosmonauta",
};

export interface AvatarSuggestion {
  seed: string;
  style: AvatarStyle;
}

const C = {
  bg0: "#061314",
  bg1: "#0B1F21",
  line: "#143235",
  t1: "#14B8A6",
  t2: "#2DD4BF",
  t3: "#5EEAD4",
  w: "#F2FBFA",
} as const;

export const AVATAR_PALETTE: readonly string[] = Object.values(C);

// ---------- Utilidades ----------

export function hash32(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
}

interface Rng {
  next(): number;
  range(lo: number, hi: number): number;
  int(lo: number, hi: number): number;
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
}

function makeRng(str: string): Rng {
  let a = hash32(str);
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next();
  next();
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

const f = (n: number) => String(+n.toFixed(2));

type Stop = [number, string, number?];

function stops(list: Stop[]): string {
  return list
    .map(([o, c, op]) => `<stop offset="${f(o)}" stop-color="${c}"${op !== undefined && op < 1 ? ` stop-opacity="${f(op)}"` : ""}/>`)
    .join("");
}

function lin(id: string, x1: number, y1: number, x2: number, y2: number, list: Stop[]): string {
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops(list)}</linearGradient>`;
}

function rad(id: string, cx: number, cy: number, r: number, list: Stop[], fx?: number, fy?: number): string {
  const focus = fx !== undefined && fy !== undefined ? ` fx="${f(fx)}" fy="${f(fy)}"` : "";
  return `<radialGradient id="${id}" cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}"${focus}>${stops(list)}</radialGradient>`;
}

function sparkle(x: number, y: number, s: number, fill: string, opacity = 1): string {
  const k = s * 0.18;
  return (
    `<path d="M${f(x)} ${f(y - s)}Q${f(x + k)} ${f(y - k)} ${f(x + s)} ${f(y)}Q${f(x + k)} ${f(y + k)} ${f(x)} ${f(y + s)}` +
    `Q${f(x - k)} ${f(y + k)} ${f(x - s)} ${f(y)}Q${f(x - k)} ${f(y - k)} ${f(x)} ${f(y - s)}Z" fill="${fill}"${opacity < 1 ? ` opacity="${f(opacity)}"` : ""}/>`
  );
}

interface Ctx {
  r: Rng;
  P: string; // prefijo único de ids
  d: string[]; // defs
  b: string[]; // cuerpo
}

// ---------- Fondo ----------

function background(c: Ctx) {
  const { r, P, d, b } = c;
  const gx = r.range(0.3, 0.7);
  const gy = r.range(0.3, 0.7);
  const bgStops: Stop[] = r.chance(0.5)
    ? [[0, C.line, 0.95], [0.55, C.bg1], [1, C.bg0]]
    : [[0, C.bg1], [1, C.bg0]];
  d.push(rad(`${P}bg`, gx, gy, 0.85, bgStops));
  b.push(`<rect width="256" height="256" fill="${C.bg0}"/>`);
  b.push(`<rect width="256" height="256" fill="url(#${P}bg)"/>`);
  // Tinte de acento opcional en una esquina
  if (r.chance(0.7)) {
    const ax = r.range(0, 256);
    const ay = r.range(0, 256);
    d.push(rad(`${P}ac`, 0.5, 0.5, 0.5, [[0, r.pick([C.t1, C.t2]), 0.2], [1, C.t1, 0]]));
    b.push(`<circle cx="${f(ax)}" cy="${f(ay)}" r="${f(r.range(70, 120))}" fill="url(#${P}ac)"/>`);
  }
}

function starfield(c: Ctx) {
  const { r, b } = c;
  const n = r.int(30, 46);
  for (let i = 0; i < n; i++) {
    const big = r.chance(0.14);
    const rr = big ? r.range(1.3, 1.9) : r.range(0.5, 1.1);
    b.push(
      `<circle cx="${f(r.range(4, 252))}" cy="${f(r.range(4, 252))}" r="${f(rr)}" fill="${r.chance(0.6) ? C.w : C.t3}" opacity="${f(r.range(0.3, 0.95))}"/>`,
    );
  }
  const k = r.int(2, 4);
  for (let i = 0; i < k; i++) {
    b.push(sparkle(r.range(12, 244), r.range(12, 244), r.range(3.5, 6.5), r.chance(0.5) ? C.w : C.t3, r.range(0.6, 0.95)));
  }
}

// ---------- Estilos ----------

function astronaut(c: Ctx) {
  const { r, P, d, b } = c;
  const tilt = r.range(-13, 13);
  const shell = r.pick([
    [C.w, C.t3, C.t1],
    [C.t3, C.t1, C.line],
    [C.w, C.t2, C.line],
  ] as const);
  d.push(lin(`${P}sh`, 0.15, 0, 0.85, 1, [[0, shell[0]], [0.5, shell[1]], [1, shell[2]]]));
  d.push(lin(`${P}su`, 0, 0, 0, 1, [[0, shell[1]], [1, shell[2]]]));
  d.push(lin(`${P}vi`, 0.2, 0, 0.8, 1, [[0, C.bg0], [1, C.line]]));
  d.push(rad(`${P}vg`, 0.5, 1, 0.9, [[0, C.t1, 0.5], [1, C.t1, 0]]));
  d.push(lin(`${P}pl`, 0.2, 0, 0.8, 1, [[0, C.t3], [1, C.t1]]));
  d.push(`<clipPath id="${P}vc"><ellipse cx="128" cy="118" rx="49" ry="42"/></clipPath>`);

  const patch = r.pick([C.t2, C.t1, C.t3]);
  const g: string[] = [];
  // Cuerpo
  g.push(`<path d="M46 262C46 204 80 178 128 178C176 178 210 204 210 262Z" fill="url(#${P}su)"/>`);
  g.push(`<rect x="106" y="204" width="44" height="30" rx="7" fill="${C.bg1}" opacity="0.9"/>`);
  g.push(`<circle cx="118" cy="214" r="3.2" fill="${C.t2}"/><circle cx="130" cy="214" r="3.2" fill="${C.w}"/><circle cx="142" cy="214" r="3.2" fill="${C.t1}"/>`);
  g.push(`<rect x="114" y="223" width="28" height="4" rx="2" fill="${C.t3}" opacity="0.8"/>`);
  g.push(`<circle cx="74" cy="226" r="9" fill="${patch}"/><circle cx="74" cy="226" r="9" fill="none" stroke="${C.bg0}" stroke-opacity="0.45" stroke-width="2"/>`);
  g.push(sparkle(74, 226, 5, C.bg0, 0.7));
  // Cuello y casco
  g.push(`<ellipse cx="128" cy="178" rx="46" ry="11" fill="${C.t1}"/><ellipse cx="128" cy="176" rx="46" ry="9" fill="none" stroke="${C.bg0}" stroke-opacity="0.3" stroke-width="2"/>`);
  // Antena
  const off = r.range(-30, 30);
  const hy = 118 - Math.sqrt(66 * 66 - off * off);
  g.push(`<path d="M${f(128 + off)} ${f(hy + 2)}L${f(128 + off * 1.25)} ${f(hy - 20)}" stroke="${C.t3}" stroke-width="3" stroke-linecap="round"/>`);
  g.push(`<circle cx="${f(128 + off * 1.25)}" cy="${f(hy - 22)}" r="9" fill="${C.t2}" opacity="0.28"/><circle cx="${f(128 + off * 1.25)}" cy="${f(hy - 22)}" r="4.2" fill="${C.t2}"/>`);
  // Orejeras
  g.push(`<circle cx="62" cy="120" r="11" fill="${C.t1}"/><circle cx="194" cy="120" r="11" fill="${C.t1}"/>`);
  g.push(`<circle cx="62" cy="120" r="5" fill="${C.bg0}" opacity="0.45"/><circle cx="194" cy="120" r="5" fill="${C.bg0}" opacity="0.45"/>`);
  g.push(`<circle cx="128" cy="118" r="66" fill="url(#${P}sh)"/>`);
  g.push(`<circle cx="128" cy="118" r="66" fill="none" stroke="${C.bg0}" stroke-opacity="0.35" stroke-width="2"/>`);
  // Visera
  g.push(`<ellipse cx="128" cy="118" rx="49" ry="42" fill="url(#${P}vi)"/>`);
  g.push(`<g clip-path="url(#${P}vc)">`);
  g.push(`<rect x="70" y="70" width="116" height="100" fill="url(#${P}vg)"/>`);
  const refl = r.int(0, 2);
  if (refl === 0) {
    const px = 128 + r.range(6, 24);
    const py = 118 + r.range(-8, 12);
    const pr = r.range(11, 16);
    const rot = r.range(-35, -10);
    g.push(`<g transform="translate(${f(px)} ${f(py)}) rotate(${f(rot)})">`);
    g.push(`<ellipse rx="${f(pr * 1.9)}" ry="${f(pr * 0.5)}" fill="none" stroke="${C.w}" stroke-opacity="0.65" stroke-width="2"/>`);
    g.push(`<circle r="${f(pr)}" fill="url(#${P}pl)"/>`);
    g.push(`<path d="M${f(-pr * 1.9)} 0A${f(pr * 1.9)} ${f(pr * 0.5)} 0 0 0 ${f(pr * 1.9)} 0" fill="none" stroke="${C.w}" stroke-opacity="0.8" stroke-width="2"/>`);
    g.push(`</g>`);
    for (let i = 0; i < 4; i++) g.push(`<circle cx="${f(r.range(86, 168))}" cy="${f(r.range(86, 150))}" r="${f(r.range(0.7, 1.5))}" fill="${C.w}" opacity="0.8"/>`);
  } else if (refl === 1) {
    g.push(sparkle(128 + r.range(-14, 14), 112 + r.range(-8, 8), r.range(11, 16), C.w, 0.95));
    for (let i = 0; i < 7; i++) g.push(`<circle cx="${f(r.range(84, 172))}" cy="${f(r.range(84, 152))}" r="${f(r.range(0.8, 1.8))}" fill="${r.chance(0.5) ? C.w : C.t3}" opacity="0.85"/>`);
  } else {
    const pts: [number, number][] = [
      [r.range(94, 108), r.range(118, 134)],
      [r.range(114, 134), r.range(96, 112)],
      [r.range(140, 154), r.range(110, 126)],
      [r.range(150, 164), r.range(92, 104)],
    ];
    g.push(`<path d="M${pts.map((p) => `${f(p[0])} ${f(p[1])}`).join("L")}" fill="none" stroke="${C.t3}" stroke-width="1.4" opacity="0.8"/>`);
    for (const p of pts) g.push(`<circle cx="${f(p[0])}" cy="${f(p[1])}" r="3" fill="${C.w}"/>`);
  }
  g.push(`<ellipse cx="104" cy="96" rx="22" ry="8" transform="rotate(-38 104 96)" fill="${C.w}" opacity="0.16"/>`);
  g.push(`<circle cx="92" cy="112" r="2" fill="${C.w}" opacity="0.6"/>`);
  g.push(`</g>`);
  g.push(`<ellipse cx="128" cy="118" rx="49" ry="42" fill="none" stroke="${C.t2}" stroke-opacity="0.7" stroke-width="2.5"/>`);

  b.push(`<g transform="rotate(${f(tilt)} 128 128)">${g.join("")}</g>`);
  // Brillos sueltos cerca
  b.push(sparkle(r.range(30, 56), r.range(44, 90), r.range(6, 9), C.t3, 0.9));
}

function planet(c: Ctx) {
  const { r, P, d, b } = c;
  const tilt = (r.chance(0.5) ? -1 : 1) * r.range(12, 34);
  const R = r.range(35, 45);
  const rx = Math.min(R * r.range(1.85, 2.1), 94);
  const ry = rx * r.range(0.2, 0.3);
  const ringA = r.pick([C.t3, C.w, C.t2]);
  const col = r.pick([
    [C.t3, C.t1, C.bg1],
    [C.w, C.t2, C.line],
    [C.t2, C.t1, C.bg0],
  ] as const);
  d.push(rad(`${P}pb`, 0.38, 0.3, 0.85, [[0, col[0]], [0.5, col[1]], [1, col[2]]]));
  d.push(rad(`${P}ps`, 0.38, 0.3, 0.85, [[0, C.bg0, 0], [0.55, C.bg0, 0], [1, C.bg0, 0.8]]));
  d.push(`<clipPath id="${P}pc"><circle r="${f(R)}"/></clipPath>`);
  const g: string[] = [];
  // Anillos detrás
  g.push(`<ellipse rx="${f(rx * 0.92)}" ry="${f(ry * 0.92)}" fill="none" stroke="${ringA}" stroke-opacity="0.22" stroke-width="9"/>`);
  g.push(`<ellipse rx="${f(rx)}" ry="${f(ry)}" fill="none" stroke="${ringA}" stroke-opacity="0.9" stroke-width="2.2"/>`);
  g.push(`<ellipse rx="${f(rx * 0.84)}" ry="${f(ry * 0.84)}" fill="none" stroke="${C.t1}" stroke-opacity="0.9" stroke-width="1.6" stroke-dasharray="${r.int(2, 5)} ${r.int(4, 8)}"/>`);
  // Planeta
  g.push(`<circle r="${f(R)}" fill="url(#${P}pb)"/>`);
  g.push(`<g clip-path="url(#${P}pc)">`);
  const bands = r.int(3, 5);
  for (let i = 0; i < bands; i++) {
    const y = r.range(-R * 0.8, R * 0.8);
    g.push(
      `<path d="M${f(-R)} ${f(y)}Q0 ${f(y + r.range(-8, 8))} ${f(R)} ${f(y)}" fill="none" stroke="${r.pick([C.w, C.t2, C.bg1])}" stroke-opacity="${f(r.range(0.14, 0.32))}" stroke-width="${f(r.range(3, 8))}"/>`,
    );
  }
  if (r.chance(0.6)) g.push(`<circle cx="${f(r.range(-R * 0.4, R * 0.4))}" cy="${f(r.range(-R * 0.4, R * 0.4))}" r="${f(r.range(4, 8))}" fill="${C.bg0}" opacity="0.22"/>`);
  g.push(`</g>`);
  g.push(`<circle r="${f(R)}" fill="url(#${P}ps)"/>`);
  // Anillo delantero
  g.push(`<path d="M${f(-rx * 0.92)} 0A${f(rx * 0.92)} ${f(ry * 0.92)} 0 0 0 ${f(rx * 0.92)} 0" fill="none" stroke="${ringA}" stroke-opacity="0.22" stroke-width="9"/>`);
  g.push(`<path d="M${f(-rx)} 0A${f(rx)} ${f(ry)} 0 0 0 ${f(rx)} 0" fill="none" stroke="${ringA}" stroke-width="2.4"/>`);
  g.push(`<path d="M${f(-rx * 0.84)} 0A${f(rx * 0.84)} ${f(ry * 0.84)} 0 0 0 ${f(rx * 0.84)} 0" fill="none" stroke="${C.t1}" stroke-width="1.6"/>`);
  b.push(`<g transform="translate(128 128) rotate(${f(tilt)})">${g.join("")}</g>`);
  // Luna
  const ang = r.range(0, Math.PI * 2);
  const mx = 128 + Math.cos(ang) * 88;
  const my = 128 + Math.sin(ang) * 88;
  d.push(rad(`${P}mo`, 0.35, 0.3, 0.8, [[0, C.w], [1, C.t1]]));
  b.push(`<circle cx="${f(mx)}" cy="${f(my)}" r="${f(r.range(6, 9))}" fill="url(#${P}mo)"/>`);
  b.push(sparkle(r.range(26, 60), r.range(26, 60), r.range(5, 8), C.w, 0.9));
}

function constellation(c: Ctx) {
  const { r, P, d, b } = c;
  const n = r.int(7, 9);
  const pts: [number, number][] = [];
  let tries = 0;
  while (pts.length < n && tries < 400) {
    tries++;
    const a = r.range(0, Math.PI * 2);
    const rr = Math.sqrt(r.next()) * 80;
    const x = 128 + Math.cos(a) * rr;
    const y = 128 + Math.sin(a) * rr;
    if (pts.every((p) => Math.hypot(p[0] - x, p[1] - y) > 27)) pts.push([x, y]);
  }
  const ordered = pts
    .map((p) => ({ p, a: Math.atan2(p[1] - 128, p[0] - 128) }))
    .sort((x, y) => x.a - y.a)
    .map((o) => o.p);
  d.push(rad(`${P}sg`, 0.5, 0.5, 0.5, [[0, C.t2, 0.5], [1, C.t2, 0]]));
  d.push(rad(`${P}cg`, 0.5, 0.5, 0.5, [[0, C.t1, 0.28], [1, C.t1, 0]]));
  b.push(`<circle cx="128" cy="128" r="104" fill="url(#${P}cg)"/>`);
  b.push(`<circle cx="128" cy="128" r="92" fill="none" stroke="${C.t1}" stroke-opacity="0.35" stroke-width="1" stroke-dasharray="2 6"/>`);
  const path = ordered.map((p, i) => `${i ? "L" : "M"}${f(p[0])} ${f(p[1])}`).join("");
  const closed = r.chance(0.5);
  b.push(`<path d="${path}${closed ? "Z" : ""}" fill="none" stroke="${C.t3}" stroke-opacity="0.75" stroke-width="2.4" stroke-linejoin="round"/>`);
  const chords = r.int(1, 3);
  for (let i = 0; i < chords; i++) {
    const a = ordered[r.int(0, ordered.length - 1)];
    const z = ordered[r.int(0, ordered.length - 1)];
    if (a !== z) b.push(`<path d="M${f(a[0])} ${f(a[1])}L${f(z[0])} ${f(z[1])}" stroke="${C.t2}" stroke-opacity="0.55" stroke-width="1.8" stroke-dasharray="4 4"/>`);
  }
  const bigA = r.int(0, ordered.length - 1);
  const bigB = (bigA + r.int(2, ordered.length - 2)) % ordered.length;
  ordered.forEach((p, i) => {
    const big = i === bigA || i === bigB;
    b.push(`<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${big ? 17 : 11}" fill="url(#${P}sg)"/>`);
    b.push(`<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(big ? r.range(4.5, 5.5) : r.range(2.6, 3.8))}" fill="${C.w}"/>`);
    if (big) b.push(sparkle(p[0], p[1], r.range(13, 17), C.t3, 0.95));
  });
}

function rocket(c: Ctx) {
  const { r, P, d, b } = c;
  const angle = r.range(30, 60) * (r.chance(0.5) ? 1 : -1);
  const s = r.range(0.95, 1.1);
  d.push(lin(`${P}rb`, 0, 0, 1, 0, [[0, C.t3], [0.45, C.w], [1, C.t2]]));
  d.push(lin(`${P}rf`, 0, 0, 0, 1, [[0, C.w], [0.35, C.t3], [0.75, C.t1, 0.8], [1, C.t1, 0]]));
  d.push(lin(`${P}rg`, 0, 0, 0, 1, [[0, C.t1, 0.4], [1, C.t1, 0]]));
  d.push(`<clipPath id="${P}rc"><path d="M0 -62C22 -40 24 -6 18 30L-18 30C-24 -6 -22 -40 0 -62Z"/></clipPath>`);
  d.push(lin(`${P}rp`, 0.2, 0, 0.8, 1, [[0, C.t3], [1, C.t1]]));
  // Planeta parcial al fondo, del lado opuesto a la cola
  const side = angle > 0 ? 1 : -1;
  b.push(`<circle cx="${f(128 + side * r.range(64, 80))}" cy="${f(r.range(186, 204))}" r="${f(r.range(22, 30))}" fill="url(#${P}rp)" opacity="0.5"/>`);
  const g: string[] = [];
  g.push(`<ellipse cx="0" cy="42" rx="26" ry="52" fill="url(#${P}rg)" opacity="0.7"/>`);
  g.push(`<path d="M-9 36C-13 56 -5 72 0 90C5 72 13 56 9 36Z" fill="url(#${P}rf)"/>`);
  g.push(`<path d="M-4.5 38C-6 52 -2 62 0 70C2 62 6 52 4.5 38Z" fill="${C.w}" opacity="0.85"/>`);
  g.push(`<path d="M-18 4C-34 14 -39 30 -39 44L-18 28Z" fill="${C.t1}"/><path d="M18 4C34 14 39 30 39 44L18 28Z" fill="${C.t1}"/>`);
  g.push(`<path d="M0 -62C22 -40 24 -6 18 30L-18 30C-24 -6 -22 -40 0 -62Z" fill="url(#${P}rb)"/>`);
  g.push(`<g clip-path="url(#${P}rc)"><rect x="-30" y="-64" width="60" height="30" fill="${C.t1}"/><rect x="-30" y="12" width="60" height="7" fill="${C.t2}"/></g>`);
  g.push(`<rect x="-10" y="30" width="20" height="7" rx="2" fill="${C.line}"/>`);
  g.push(`<circle cx="0" cy="-14" r="11" fill="${C.t3}"/><circle cx="0" cy="-14" r="8" fill="${C.bg0}"/><circle cx="-2.5" cy="-16.5" r="2.4" fill="${C.w}" opacity="0.8"/>`);
  b.push(`<g transform="translate(128 128) rotate(${f(angle)}) scale(${f(s)}) translate(0 -12)">${g.join("")}</g>`);
  // Líneas de velocidad paralelas a la cola
  const ar = (angle * Math.PI) / 180;
  const dir = [-Math.sin(ar), Math.cos(ar)];
  const lat = [Math.cos(ar), Math.sin(ar)];
  for (let i = 0; i < 4; i++) {
    const off = (r.chance(0.5) ? -1 : 1) * r.range(30, 52);
    const d0 = r.range(30, 62);
    const len = r.range(16, 34);
    const x1 = 128 + dir[0] * d0 + lat[0] * off;
    const y1 = 128 + dir[1] * d0 + lat[1] * off;
    b.push(`<path d="M${f(x1)} ${f(y1)}L${f(x1 + dir[0] * len)} ${f(y1 + dir[1] * len)}" stroke="${C.t3}" stroke-opacity="${f(r.range(0.3, 0.6))}" stroke-width="${f(r.range(1.2, 2.2))}" stroke-linecap="round"/>`);
  }
  b.push(sparkle(r.range(26, 70), r.range(30, 70), r.range(5, 8), C.w, 0.9));
}

function nebula(c: Ctx) {
  const { r, P, d, b } = c;
  d.push(`<filter id="${P}bl" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4.5"/></filter>`);
  const n = r.int(5, 7);
  const cols = [C.t1, C.t2, C.t3, C.t1];
  for (let i = 0; i < n; i++) {
    const col = r.pick(cols);
    d.push(rad(`${P}n${i}`, 0.5, 0.5, 0.5, [[0, col, r.range(0.55, 0.85)], [0.6, col, 0.2], [1, col, 0]]));
    const a = r.range(0, Math.PI * 2);
    const rr = r.range(0, 52);
    b.push(`<circle cx="${f(128 + Math.cos(a) * rr)}" cy="${f(128 + Math.sin(a) * rr)}" r="${f(r.range(38, 66))}" fill="url(#${P}n${i})"/>`);
  }
  // Veta oscura
  d.push(rad(`${P}dk`, 0.5, 0.5, 0.5, [[0, C.bg0, 0.7], [1, C.bg0, 0]]));
  b.push(`<ellipse cx="${f(r.range(100, 156))}" cy="${f(r.range(100, 156))}" rx="${f(r.range(30, 46))}" ry="${f(r.range(8, 14))}" transform="rotate(${f(r.range(-50, 50))} 128 128)" fill="url(#${P}dk)"/>`);
  // Hilos de luz
  const w = r.int(3, 4);
  for (let i = 0; i < w; i++) {
    const a = r.range(0, Math.PI * 2);
    const x1 = 128 + Math.cos(a) * r.range(30, 80);
    const y1 = 128 + Math.sin(a) * r.range(30, 80);
    const x2 = 128 + Math.cos(a + r.range(1.4, 2.6)) * r.range(30, 80);
    const y2 = 128 + Math.sin(a + r.range(1.4, 2.6)) * r.range(30, 80);
    const cx = 128 + r.range(-40, 40);
    const cy = 128 + r.range(-40, 40);
    b.push(`<path d="M${f(x1)} ${f(y1)}Q${f(cx)} ${f(cy)} ${f(x2)} ${f(y2)}" fill="none" stroke="${r.pick([C.t3, C.w, C.t2])}" stroke-opacity="${f(r.range(0.25, 0.42))}" stroke-width="${f(r.range(5, 9))}" stroke-linecap="round" filter="url(#${P}bl)"/>`);
  }
  // Polvo estelar y núcleo
  for (let i = 0; i < 24; i++) {
    const a = r.range(0, Math.PI * 2);
    const rr = Math.sqrt(r.next()) * 78;
    b.push(`<circle cx="${f(128 + Math.cos(a) * rr)}" cy="${f(128 + Math.sin(a) * rr)}" r="${f(r.range(0.6, 1.5))}" fill="${C.w}" opacity="${f(r.range(0.5, 0.95))}"/>`);
  }
  const sx = 128 + r.range(-26, 26);
  const sy = 128 + r.range(-26, 26);
  d.push(rad(`${P}ns`, 0.5, 0.5, 0.5, [[0, C.w, 0.9], [0.4, C.t3, 0.35], [1, C.t3, 0]]));
  b.push(`<circle cx="${f(sx)}" cy="${f(sy)}" r="26" fill="url(#${P}ns)"/>`);
  b.push(sparkle(sx, sy, r.range(15, 20), C.w, 1));
  b.push(`<circle cx="${f(sx)}" cy="${f(sy)}" r="3.4" fill="${C.w}"/>`);
}

function portal(c: Ctx) {
  const { r, P, d, b } = c;
  d.push(rad(`${P}pg`, 0.5, 0.5, 0.5, [[0, C.t1, 0.45], [0.7, C.t1, 0.12], [1, C.t1, 0]]));
  d.push(rad(`${P}pc`, 0.5, 0.5, 0.5, [[0, C.w], [0.35, C.t3, 0.9], [1, C.t2, 0]]));
  b.push(`<circle cx="128" cy="128" r="106" fill="url(#${P}pg)"/>`);
  const rings = r.int(4, 5);
  const cols = [C.t2, C.t3, C.t1, C.w, C.t2, C.t3];
  const start = r.range(22, 28);
  const step = (88 - start) / (rings - 1);
  for (let i = 0; i < rings; i++) {
    const rr = start + step * i;
    const circ = 2 * Math.PI * rr;
    const dash = r.range(5, 16);
    const gap = r.range(4, 14);
    const sw = i === rings - 1 ? 2 : r.range(2.2, 4.2);
    const rot = r.range(0, 360);
    b.push(
      `<circle cx="128" cy="128" r="${f(rr)}" fill="none" stroke="${i === rings - 1 ? C.t1 : cols[i]}" stroke-opacity="${f(r.range(0.6, 1))}" stroke-width="${f(sw)}" stroke-dasharray="${f(dash)} ${f(gap)}" transform="rotate(${f(rot)} 128 128)"/>`,
    );
    if (i > 0 && i % 2 === 1 && r.chance(0.8)) {
      const arc = circ * r.range(0.14, 0.3);
      b.push(
        `<circle cx="128" cy="128" r="${f(rr - 5)}" fill="none" stroke="${C.w}" stroke-width="${f(r.range(2.6, 4.2))}" stroke-linecap="round" stroke-dasharray="${f(arc)} ${f(circ * 4)}" transform="rotate(${f(r.range(0, 360))} 128 128)"/>`,
      );
    }
    if (r.chance(0.7)) {
      const a = r.range(0, Math.PI * 2);
      b.push(`<circle cx="${f(128 + Math.cos(a) * rr)}" cy="${f(128 + Math.sin(a) * rr)}" r="${f(r.range(2.4, 4))}" fill="${C.w}"/>`);
    }
  }
  b.push(`<circle cx="128" cy="128" r="22" fill="url(#${P}pc)"/>`);
  b.push(sparkle(128, 128, r.range(12, 17), C.w, 1));
}

function eclipse(c: Ctx) {
  const { r, P, d, b } = c;
  const ang = r.range(0, Math.PI * 2);
  const off = r.range(3, 12);
  const M = r.range(38, 54);
  const dx = Math.cos(ang) * off;
  const dy = Math.sin(ang) * off;
  d.push(rad(`${P}co`, 0.5, 0.5, 0.5, [[(M - 2) / 104, C.w, 0.95], [(M + 4) / 104, C.t3, 0.6], [(M + 24) / 104, C.t1, 0.25], [1, C.t1, 0]]));
  d.push(lin(`${P}md`, 0.2, 0, 0.8, 1, [[0, C.bg1], [1, C.bg0]]));
  b.push(`<circle cx="128" cy="128" r="104" fill="url(#${P}co)"/>`);
  const rays = r.int(14, 22);
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + r.range(-0.1, 0.1);
    const r1 = M + 7;
    const r2 = M + 7 + r.range(10, 40 - (M - 38) * 0.6);
    b.push(
      `<path d="M${f(128 + Math.cos(a) * r1)} ${f(128 + Math.sin(a) * r1)}L${f(128 + Math.cos(a) * r2)} ${f(128 + Math.sin(a) * r2)}" stroke="${r.chance(0.5) ? C.w : C.t3}" stroke-opacity="${f(r.range(0.35, 0.75))}" stroke-width="${f(r.range(0.8, 2))}" stroke-linecap="round"/>`,
    );
  }
  b.push(`<circle cx="128" cy="128" r="${f(M + 3)}" fill="none" stroke="${C.w}" stroke-width="2.4"/>`);
  b.push(`<circle cx="${f(128 + dx)}" cy="${f(128 + dy)}" r="${f(M)}" fill="url(#${P}md)"/>`);
  const cr = r.int(2, 4);
  for (let i = 0; i < cr; i++) {
    const a = r.range(0, Math.PI * 2);
    const rr = r.range(6, 32);
    b.push(`<circle cx="${f(128 + dx + Math.cos(a) * rr)}" cy="${f(128 + dy + Math.sin(a) * rr)}" r="${f(r.range(3, 8))}" fill="${C.line}" opacity="0.55"/>`);
  }
  // Anillo de diamante
  const bx = 128 - Math.cos(ang) * (M + 2);
  const by = 128 - Math.sin(ang) * (M + 2);
  b.push(`<circle cx="${f(bx)}" cy="${f(by)}" r="10" fill="${C.w}" opacity="0.3"/>`);
  b.push(sparkle(bx, by, r.range(14, 19), C.w, 1));
}

const RENDERERS: Record<LegacyStyle, (c: Ctx) => void> = {
  astronaut,
  planet,
  constellation,
  rocket,
  nebula,
  portal,
  eclipse,
};

// ---------- API pública ----------

export function isAvatarStyle(value: unknown): value is AvatarStyle {
  return typeof value === "string" && (AVATAR_STYLES as readonly string[]).includes(value);
}

/** Longest seed that is ever used (matches profiles_avatar_seed_safe in 0002_hardening.sql). */
export const AVATAR_SEED_MAX = 64;

/** Characters a stored seed may contain (also enforced by the database CHECK). */
export const AVATAR_SEED_RE = /^[A-Za-z0-9:_.-]{1,64}$/;

/** True for a seed the database would accept. */
export function isValidAvatarSeed(value: unknown): value is string {
  return typeof value === "string" && AVATAR_SEED_RE.test(value);
}

/**
 * Whatever came from the database or a URL, as a seed: a string of at most 64
 * characters. It is only ever fed to the hash/RNG, never written into markup.
 */
export function clampSeed(seed: unknown): string {
  return typeof seed === "string" ? seed.slice(0, AVATAR_SEED_MAX) : "";
}

export function pickStyle(seed: string): LegacyStyle {
  return LEGACY_AVATAR_STYLES[hash32(`${clampSeed(seed)}#style`) % LEGACY_AVATAR_STYLES.length];
}

/**
 * Deterministic SVG for a seed and style. Defensive on purpose, because the
 * result is injected with dangerouslySetInnerHTML: the seed is truncated to 64
 * characters, an unknown style falls back to `pickStyle(seed)`, and neither
 * value is ever interpolated into the markup (the only dynamic text is the
 * id prefix `kv` + base36 digits, derived from a hash).
 */
export function renderAvatar(seedInput: string, styleInput?: AvatarStyle | string | null): string {
  const seed = clampSeed(seedInput);
  if (styleInput === "kosmonauta") return kosmonautaSvg(decodificar(seed));
  const st: LegacyStyle = isAvatarStyle(styleInput) && styleInput !== "kosmonauta" ? styleInput : pickStyle(seed);
  const r = makeRng(`${seed}|${st}`);
  const P = `kv${hash32(`${seed}|${st}`).toString(36)}`;
  const ctx: Ctx = { r, P, d: [], b: [] };
  background(ctx);
  starfield(ctx);
  RENDERERS[st](ctx);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" aria-hidden="true" focusable="false">` +
    `<defs>${ctx.d.join("")}</defs>${ctx.b.join("")}</svg>`
  );
}

// Sugerencias estables a partir de la dirección. Con 6 o menos, cada una tiene un estilo distinto.
export function suggestions(base: string, count = 6): AvatarSuggestion[] {
  const offset = hash32(`${base}#offset`) % LEGACY_AVATAR_STYLES.length;
  const out: AvatarSuggestion[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      seed: `${base}:${i}`,
      style: LEGACY_AVATAR_STYLES[(offset + i) % LEGACY_AVATAR_STYLES.length],
    });
  }
  return out;
}

export function randomSeed(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
}
