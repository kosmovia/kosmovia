// Genera los avatares Kosmonauta del equipo para el pitch (web/public/team/*.svg).
// Usa el mismo generador de la app, con una semilla fija por persona: siempre sale igual.
// Uso, desde web/: node --experimental-strip-types scripts/team-avatars.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { aleatorio, hash32, svg } from "../../app/lib/core/avatar/kosmonautas.ts";

const TEAM = ["alejandro", "roberto", "victor", "carla"];

// Generador pseudoaleatorio con semilla (mulberry32).
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

mkdirSync("public/team", { recursive: true });
for (const name of TEAM) {
  const sel = aleatorio(undefined, {}, seeded(hash32(`kosmovia-team:${name}`)));
  writeFileSync(`public/team/${name}.svg`, svg(sel));
  console.log(name, "ok");
}
