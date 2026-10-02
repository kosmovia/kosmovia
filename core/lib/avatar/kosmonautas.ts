// Kosmonautas: avatares en pixel art de 24×24 armados por capas.
// Cada rasgo dibuja sobre la misma grilla; el avatar se guarda como la lista
// de rasgos elegidos (no como imagen) y se vuelve a dibujar igual en cualquier lado.
// Sin importaciones (corre directo bajo node --experimental-strip-types y bajo Next).
//
// IMPORTANTE: el código guardado usa la posición de cada rasgo en su lista.
// Opciones nuevas van SIEMPRE al final; nunca reordenar ni borrar.

export const SIZE = 24;

const C = {
  ink: "#061314",
  surface: "#0B1F21",
  line: "#143235",
  fg: "#F2FBFA",
  mist: "#DCE8E7",
  muted: "#8FB3B0",
  accent: "#2DD4BF",
  accentStrong: "#14B8A6",
  glow: "#5EEAD4",
  teal: "#0F8F84",
  tealDeep: "#0B7A70",
  red: "#F87171",
} as const;

// ---------- grilla y máscaras ----------

type Mask = Set<number>;
const at = (x: number, y: number) => y * SIZE + x;
const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;

function mask(test: (x: number, y: number) => boolean): Mask {
  const m: Mask = new Set();
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (test(x, y)) m.add(at(x, y));
  return m;
}
const disk = (cx: number, cy: number, r: number) =>
  mask((x, y) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r);
const rect = (x0: number, y0: number, x1: number, y1: number) =>
  mask((x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
const pts = (...p: [number, number][]) => new Set(p.filter(([x, y]) => inside(x, y)).map(([x, y]) => at(x, y)));
const union = (...ms: Mask[]) => new Set(ms.flatMap((m) => [...m]));
const minus = (a: Mask, b: Mask) => new Set([...a].filter((i) => !b.has(i)));
const filter = (m: Mask, f: (x: number, y: number) => boolean) =>
  new Set([...m].filter((i) => f(i % SIZE, Math.floor(i / SIZE))));

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => {
    const ca = (pa >> s) & 255;
    const cb = (pb >> s) & 255;
    return Math.round(ca + (cb - ca) * t);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0").toUpperCase()}`;
}

class Painter {
  px: (string | null)[] = new Array(SIZE * SIZE).fill(null);
  /** Hueco de la cara: lo define el casco y lo usan ojos, boca y visor. */
  face: Mask = disk(12, 10.5, 5.5);

  fill(m: Mask, c: string) {
    for (const i of m) this.px[i] = c;
  }
  /** Contorno de 1 px alrededor de la máscara (estilo punk). */
  outline(m: Mask, c: string = C.ink) {
    for (const i of m) {
      const x = i % SIZE;
      const y = Math.floor(i / SIZE);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (inside(nx, ny) && !m.has(at(nx, ny))) this.px[at(nx, ny)] = c;
      }
    }
  }
  solid(m: Mask, c: string) {
    this.outline(m);
    this.fill(m, c);
  }
  blend(m: Mask, c: string, t: number) {
    for (const i of m) this.px[i] = mix(this.px[i] ?? C.ink, c, t);
  }
}

// ---------- rasgos ----------

export type Categoria = "fondo" | "traje" | "casco" | "ojos" | "boca" | "visor" | "accesorio";

export interface Rasgo {
  id: string;
  nombre: string;
  draw: (p: Painter) => void;
}

/** Orden de dibujo = orden en que se muestran en el generador. */
export const CATEGORIAS: { key: Categoria; label: string }[] = [
  { key: "fondo", label: "Fondo" },
  { key: "traje", label: "Traje" },
  { key: "casco", label: "Casco" },
  { key: "ojos", label: "Ojos" },
  { key: "boca", label: "Boca" },
  { key: "visor", label: "Visor" },
  { key: "accesorio", label: "Accesorio" },
];

const STARS: [number, number][] = [[2, 3], [21, 2], [4, 16], [20, 14], [1, 9], [22, 8], [6, 1], [17, 0]];
const all = rect(0, 0, SIZE - 1, SIZE - 1);

const fondo: Rasgo[] = [
  { id: "menta", nombre: "Menta", draw: (p) => p.fill(all, C.glow) },
  { id: "turquesa", nombre: "Turquesa", draw: (p) => p.fill(all, C.accentStrong) },
  { id: "bruma", nombre: "Bruma", draw: (p) => p.fill(all, C.mist) },
  {
    id: "noche",
    nombre: "Noche estrellada",
    draw: (p) => {
      p.fill(all, C.surface);
      p.fill(pts(...STARS), C.fg);
      p.fill(pts([10, 1], [23, 18], [0, 20]), C.glow);
    },
  },
  {
    id: "profundo",
    nombre: "Profundo",
    draw: (p) => {
      p.fill(all, C.line);
      p.fill(pts(...STARS.slice(0, 4)), C.muted);
    },
  },
  {
    id: "nebulosa",
    nombre: "Nebulosa",
    draw: (p) => {
      p.fill(filter(all, (x, y) => x + y < 16), C.teal);
      p.fill(filter(all, (x, y) => x + y >= 16 && x + y < 30), C.accentStrong);
      p.fill(filter(all, (x, y) => x + y >= 30), C.accent);
      p.fill(pts([3, 2], [20, 3], [2, 18]), C.fg);
    },
  },
];

const body = union(rect(8, 17, 15, 18), rect(4, 19, 19, 23), rect(3, 20, 20, 23));
const traje: Rasgo[] = [
  {
    id: "clasico",
    nombre: "Clásico",
    draw: (p) => {
      p.solid(body, C.fg);
      p.fill(rect(18, 20, 20, 23), C.mist);
      p.fill(rect(10, 20, 13, 21), C.accent);
      p.fill(pts([11, 20]), C.ink);
    },
  },
  {
    id: "turquesa",
    nombre: "Turquesa",
    draw: (p) => {
      p.solid(body, C.accentStrong);
      p.fill(rect(11, 19, 12, 23), C.tealDeep);
      p.fill(union(rect(4, 19, 6, 20), rect(17, 19, 19, 20)), C.glow);
    },
  },
  {
    id: "nocturno",
    nombre: "Nocturno",
    draw: (p) => {
      p.solid(body, C.line);
      p.fill(rect(8, 17, 15, 17), C.accent);
      p.fill(rect(3, 21, 20, 21), C.accent);
    },
  },
  {
    id: "piloto",
    nombre: "Piloto",
    draw: (p) => {
      p.solid(body, C.teal);
      p.fill(filter(body, (x, y) => x - y === -10 || x - y === -11), C.fg);
      p.fill(rect(15, 21, 17, 22), C.glow);
    },
  },
  {
    id: "lunar",
    nombre: "Lunar",
    draw: (p) => {
      p.solid(body, C.muted);
      p.fill(union(rect(6, 20, 9, 22), rect(14, 20, 17, 22)), C.mist);
      p.fill(pts([11, 21], [12, 21]), C.red);
    },
  },
];

function domo(p: Painter, shell: string, shade: string, extra?: Mask) {
  const outer = union(disk(12, 10, 8), extra ?? new Set());
  p.solid(outer, shell);
  p.fill(filter(disk(12, 10, 8), (x, y) => x + y > 26), shade);
  p.face = disk(12, 10.5, 5.5);
  p.fill(p.face, C.ink);
}

const casco: Rasgo[] = [
  { id: "domo", nombre: "Domo", draw: (p) => domo(p, C.fg, C.mist) },
  { id: "turquesa", nombre: "Turquesa", draw: (p) => domo(p, C.accent, C.accentStrong) },
  { id: "lunar", nombre: "Lunar", draw: (p) => domo(p, C.muted, C.teal) },
  {
    id: "orejas",
    nombre: "Orejas",
    draw: (p) => {
      domo(p, C.fg, C.mist, union(rect(5, 1, 7, 4), rect(16, 1, 18, 4)));
      p.fill(pts([6, 2], [6, 3], [17, 2], [17, 3]), C.glow);
    },
  },
  {
    id: "escafandra",
    nombre: "Escafandra",
    draw: (p) => {
      domo(p, C.mist, C.muted);
      p.fill(pts([5, 10], [18, 10], [12, 3], [11, 3], [7, 5], [16, 5]), C.teal);
    },
  },
  {
    id: "cubo",
    nombre: "Cubo",
    draw: (p) => {
      p.solid(union(rect(5, 2, 18, 17), rect(4, 3, 19, 16)), C.fg);
      p.fill(union(rect(18, 4, 19, 16), rect(5, 16, 18, 17)), C.mist);
      p.face = minus(rect(7, 6, 16, 14), pts([7, 6], [16, 6], [7, 14], [16, 14]));
      p.fill(p.face, C.ink);
    },
  },
];

const ojos: Rasgo[] = [
  { id: "puntos", nombre: "Puntos", draw: (p) => p.fill(union(rect(9, 9, 10, 10), rect(13, 9, 14, 10)), C.glow) },
  {
    id: "brillantes",
    nombre: "Brillantes",
    draw: (p) => {
      p.fill(union(rect(9, 9, 10, 10), rect(13, 9, 14, 10)), C.glow);
      p.fill(pts([9, 9], [13, 9]), C.fg);
    },
  },
  {
    id: "felices",
    nombre: "Felices",
    draw: (p) => p.fill(pts([8, 10], [9, 9], [10, 10], [13, 10], [14, 9], [15, 10]), C.glow),
  },
  {
    id: "cansados",
    nombre: "Cansados",
    draw: (p) => {
      p.fill(union(rect(9, 9, 10, 9), rect(13, 9, 14, 9)), C.muted);
      p.fill(union(rect(9, 10, 10, 10), rect(13, 10, 14, 10)), C.glow);
    },
  },
  {
    id: "estrella",
    nombre: "Estrella",
    draw: (p) =>
      p.fill(
        pts([9, 8], [8, 9], [9, 9], [10, 9], [9, 10], [14, 8], [13, 9], [14, 9], [15, 9], [14, 10]),
        C.glow,
      ),
  },
  {
    id: "ciclope",
    nombre: "Cíclope",
    draw: (p) => {
      p.fill(rect(10, 9, 13, 10), C.glow);
      p.fill(rect(11, 9, 12, 10), C.fg);
    },
  },
  { id: "rojos", nombre: "Rojos", draw: (p) => p.fill(union(rect(9, 9, 10, 10), rect(13, 9, 14, 10)), C.red) },
];

const boca: Rasgo[] = [
  { id: "sonrisa", nombre: "Sonrisa", draw: (p) => p.fill(pts([10, 13], [13, 13], [11, 14], [12, 14]), C.glow) },
  { id: "neutral", nombre: "Neutral", draw: (p) => p.fill(rect(10, 13, 13, 13), C.glow) },
  { id: "sorpresa", nombre: "Sorpresa", draw: (p) => p.fill(rect(11, 13, 12, 14), C.glow) },
  { id: "picara", nombre: "Pícara", draw: (p) => p.fill(pts([10, 14], [11, 14], [12, 14], [13, 13]), C.glow) },
  {
    id: "colmillo",
    nombre: "Colmillo",
    draw: (p) => {
      p.fill(pts([10, 13], [13, 13], [11, 14]), C.glow);
      p.fill(pts([12, 14]), C.fg);
    },
  },
  { id: "ninguna", nombre: "Ninguna", draw: () => {} },
];

const visor: Rasgo[] = [
  { id: "ninguno", nombre: "Ninguno", draw: () => {} },
  {
    id: "reflejo",
    nombre: "Reflejo",
    draw: (p) => p.blend(filter(p.face, (x, y) => x + y >= 14 && x + y <= 15 && x < 11), C.fg, 0.75),
  },
  {
    id: "media",
    nombre: "Media visera",
    draw: (p) => p.blend(filter(p.face, (_x, y) => y <= 9), C.accent, 0.55),
  },
  {
    id: "tintado",
    nombre: "Tintado",
    draw: (p) => {
      p.blend(p.face, C.accentStrong, 0.35);
      p.blend(filter(p.face, (x, y) => x + y >= 14 && x + y <= 15 && x < 11), C.fg, 0.7);
    },
  },
  {
    id: "gafas",
    nombre: "Gafas",
    draw: (p) => {
      p.fill(rect(7, 8, 16, 11), C.muted);
      p.fill(union(rect(8, 9, 11, 10), rect(12, 9, 15, 10)), C.accent);
      p.fill(pts([8, 9], [12, 9]), C.fg);
    },
  },
  {
    id: "escaner",
    nombre: "Escáner",
    draw: (p) => p.blend(filter(p.face, (_x, y) => y === 10), C.red, 0.7),
  },
];

const accesorio: Rasgo[] = [
  { id: "ninguno", nombre: "Ninguno", draw: () => {} },
  {
    id: "antena",
    nombre: "Antena",
    draw: (p) => {
      p.fill(pts([16, 1], [16, 2]), C.muted);
      p.fill(pts([16, 0]), C.red);
    },
  },
  {
    id: "insignia",
    nombre: "Insignia",
    draw: (p) => p.fill(pts([7, 20], [6, 21], [7, 21], [8, 21], [7, 22]), C.glow),
  },
  {
    id: "auriculares",
    nombre: "Auriculares",
    draw: (p) => p.solid(union(rect(2, 8, 3, 12), rect(20, 8, 21, 12)), C.accent),
  },
  {
    id: "planeta",
    nombre: "Mini planeta",
    draw: (p) => {
      p.fill(disk(20.5, 3.5, 2.2), C.accent);
      p.fill(union(rect(17, 4, 18, 4), rect(22, 3, 23, 3)), C.fg);
      p.fill(rect(19, 4, 21, 4), C.tealDeep);
    },
  },
  {
    id: "bufanda",
    nombre: "Bufanda",
    draw: (p) => {
      p.solid(union(rect(7, 17, 16, 18), rect(14, 19, 15, 22)), C.teal);
      p.fill(union(rect(7, 17, 16, 17), rect(14, 21, 15, 21)), C.glow);
    },
  },
  {
    id: "cohete",
    nombre: "Cohete",
    draw: (p) => {
      p.fill(rect(2, 2, 2, 4), C.fg);
      p.fill(pts([2, 1]), C.red);
      p.fill(pts([1, 4], [3, 4]), C.accent);
      p.fill(pts([2, 5]), C.glow);
    },
  },
];

export const RASGOS: Record<Categoria, Rasgo[]> = { fondo, traje, casco, ojos, boca, visor, accesorio };

// ---------- selección, dibujo y metadata ----------

export type Seleccion = Record<Categoria, string>;

export const RAREZA = "Común";

export function combinaciones(): number {
  return CATEGORIAS.reduce((n, c) => n * RASGOS[c.key].length, 1);
}

function rasgo(cat: Categoria, id: string): Rasgo {
  return RASGOS[cat].find((r) => r.id === id) ?? RASGOS[cat][0];
}

export function pixeles(sel: Seleccion): (string | null)[] {
  const p = new Painter();
  for (const { key } of CATEGORIAS) rasgo(key, sel[key]).draw(p);
  return p.px;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  fill: string;
}

/** Une píxeles vecinos del mismo color en una fila para que el SVG pese poco. */
export function rects(sel: Seleccion): Rect[] {
  const px = pixeles(sel);
  const out: Rect[] = [];
  for (let y = 0; y < SIZE; y++) {
    let x = 0;
    while (x < SIZE) {
      const c = px[at(x, y)];
      let w = 1;
      while (x + w < SIZE && px[at(x + w, y)] === c) w++;
      if (c) out.push({ x, y, w, fill: c });
      x += w;
    }
  }
  return out;
}

/** SVG listo para inyectar: solo números y colores de la tabla de arriba, nada del usuario. */
export function svg(sel: Seleccion): string {
  const body = rects(sel)
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="1" fill="${r.fill}"/>`)
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" shape-rendering="crispEdges" ` +
    `aria-hidden="true" focusable="false">${body}</svg>`
  );
}

/** Rasgos en el formato de OpenSea (sirve también para mintear después). */
export function atributos(sel: Seleccion): { trait_type: string; value: string }[] {
  return [
    ...CATEGORIAS.map((c) => ({ trait_type: c.label, value: rasgo(c.key, sel[c.key]).nombre })),
    { trait_type: "Rareza", value: RAREZA },
  ];
}

/** Clave única de la combinación: sirve para impedir avatares repetidos. */
export function clave(sel: Seleccion): string {
  return CATEGORIAS.map((c) => `${c.key}:${sel[c.key]}`).join("|");
}

const pick = <T,>(xs: T[], rnd: () => number) => xs[Math.floor(rnd() * xs.length)];

/** Elige al azar cada rasgo, salvo los que tienen candado. */
export function aleatorio(
  base?: Seleccion,
  bloqueados: Partial<Record<Categoria, boolean>> = {},
  rnd: () => number = Math.random,
): Seleccion {
  const sel = {} as Seleccion;
  for (const { key } of CATEGORIAS) {
    sel[key] = base && bloqueados[key] ? base[key] : pick(RASGOS[key], rnd).id;
  }
  return sel;
}

export function siguiente(sel: Seleccion, cat: Categoria, paso: 1 | -1): Seleccion {
  const lista = RASGOS[cat];
  const i = Math.max(0, lista.findIndex((r) => r.id === sel[cat]));
  return { ...sel, [cat]: lista[(i + paso + lista.length) % lista.length].id };
}

// ---------- código guardado ----------
// "k1.<fondo>.<traje>.<casco>.<ojos>.<boca>.<visor>.<accesorio>", con la posición
// de cada rasgo. Sin ceros a la izquierda: cada combinación tiene un solo código
// (la base impide dos perfiles con el mismo).

export const CODIGO_RE = /^k1(\.(0|[1-9][0-9]?)){7}$/;

export function codificar(sel: Seleccion): string {
  return ["k1", ...CATEGORIAS.map(({ key }) => Math.max(0, RASGOS[key].findIndex((r) => r.id === sel[key])))].join(".");
}

/** Código válido y con cada posición dentro de su lista. */
export function esCodigoValido(value: unknown): value is string {
  if (typeof value !== "string" || !CODIGO_RE.test(value)) return false;
  const nums = value.split(".").slice(1).map(Number);
  return CATEGORIAS.every(({ key }, i) => nums[i] < RASGOS[key].length);
}

export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Azar repetible a partir de un número (mulberry32). */
export function azarFijo(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Del código guardado a los rasgos. Un código inválido da igual un Kosmonauta estable, sacado de su hash. */
export function decodificar(code: string): Seleccion {
  if (!esCodigoValido(code)) return aleatorio(undefined, {}, azarFijo(hash32(String(code).slice(0, 64))));
  const nums = code.split(".").slice(1).map(Number);
  const sel = {} as Seleccion;
  CATEGORIAS.forEach(({ key }, i) => {
    sel[key] = RASGOS[key][nums[i]].id;
  });
  return sel;
}
