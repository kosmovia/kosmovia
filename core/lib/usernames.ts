// Sugerencias de @usuario con la temática de Kosmovia (espacio + un guiño a Bolivia).
// Puro y sin importaciones: corre en el navegador, en el servidor y bajo node --test.
// Todo lo que sale cumple USERNAME_RE (^[a-z0-9_]{3,20}$).

/** Primera parte: el "mundo" de Kosmovia. */
export const PREFIJOS = [
  "kosmo",
  "astro",
  "nova",
  "cosmo",
  "orbita",
  "nebula",
  "stella",
  "luna",
  "cometa",
  "quasar",
  "pulsar",
  "zenit",
  "galaxia",
  "eclipse",
  "aurora",
  "vega",
  "andes",
  "illimani",
  "titikaka",
  "sajama",
] as const;

/** Segunda parte: quién eres en la tripulación. */
export const ROLES = [
  "cadet",
  "nauta",
  "pilot",
  "ranger",
  "scout",
  "voyager",
  "rider",
  "explorer",
  "navegante",
  "viajero",
  "capitan",
  "guardian",
  "builder",
  "dreamer",
  "hacker",
  "llama",
  "condor",
  "puma",
] as const;

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

const pick = <T,>(xs: readonly T[], rnd: () => number): T => xs[Math.floor(rnd() * xs.length)];
const num = (rnd: () => number, digits: 2 | 3) => String(Math.floor(rnd() * 10 ** digits)).padStart(digits, "0");

/** Un @usuario temático al azar, p. ej. "kosmocadet21", "nova_pilot07" o "condor_andes42". */
export function usernameAleatorio(rnd: () => number = Math.random): string {
  for (let i = 0; i < 20; i++) {
    const p = pick(PREFIJOS, rnd);
    const r = pick(ROLES, rnd);
    const forma = Math.floor(rnd() * 4);
    let name: string;
    if (forma === 0) name = `${p}${r}${num(rnd, 2)}`; // kosmocadet21
    else if (forma === 1) name = `${p}_${r}${num(rnd, 2)}`; // nova_pilot07
    else if (forma === 2) name = `${r}_${p}${num(rnd, 2)}`; // condor_andes42
    else name = `${p}${r}${num(rnd, 3)}`; // astroscout314
    if (USERNAME_RE.test(name)) return name;
  }
  return `kosmocadet${num(rnd, 3)}`;
}

/** `count` sugerencias distintas que no estén en `ocupados` (en minúsculas). */
export function sugerirUsernames(
  count: number,
  rnd: () => number = Math.random,
  ocupados: ReadonlySet<string> = new Set(),
): string[] {
  const out = new Set<string>();
  for (let i = 0; out.size < count && i < count * 20; i++) {
    const name = usernameAleatorio(rnd);
    if (!ocupados.has(name)) out.add(name);
  }
  return [...out];
}
