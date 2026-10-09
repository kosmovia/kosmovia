// Kosmovia · construye el símbolo (K con órbita) en SVG y exporta el kit en PNG.
// Uso, desde esta carpeta: node build.mjs   (usa el sharp que ya trae app/node_modules)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const sharp = createRequire(import.meta.url)('../../app/node_modules/sharp');

const C = { cyan: '#00F2FE', bg: '#05080C', fg: '#F0FDFA', muted: '#809CA8' };
const FONT = "Outfit, 'Century Gothic', 'Segoe UI', sans-serif";

// Órbita: elipse centrada en (627,595), a=375, b=175, girada -32.7° (sistema del boceto de 1254 px).
const cx = 627, cy = 595, a = 375, b = 175, th = (-32.7 * Math.PI) / 180;
const e1 = [Math.cos(th), Math.sin(th)], e2 = [-Math.sin(th), Math.cos(th)];
const pt = (deg) => {
  const t = (deg * Math.PI) / 180;
  return [cx + a * Math.cos(t) * e1[0] + b * Math.sin(t) * e2[0], cy + a * Math.cos(t) * e1[1] + b * Math.sin(t) * e2[1]];
};
const arc = (t0, t1, n = 72) => {
  let d = '';
  for (let i = 0; i <= n; i++) {
    const [x, y] = pt(t0 + ((t1 - t0) * i) / n);
    d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }
  return d;
};

// sw: grosor de la órbita (más grueso para íconos chicos).
function mark(fill = C.cyan, sw = 30) {
  const dot = pt(-14);
  // El brazo superior de la K se funde con la órbita en t=-30°: los bordes llegan tangentes.
  const T0 = -30, r = (T0 * Math.PI) / 180;
  const [tx, ty] = pt(T0);
  const tg = [-a * Math.sin(r) * e1[0] + b * Math.cos(r) * e2[0], -a * Math.sin(r) * e1[1] + b * Math.cos(r) * e2[1]];
  const tl = Math.hypot(...tg), u = [tg[0] / tl, tg[1] / tl], nrm = [-u[1], u[0]];
  const outP = [tx - (nrm[0] * sw) / 2, ty - (nrm[1] * sw) / 2], inP = [tx + (nrm[0] * sw) / 2, ty + (nrm[1] * sw) / 2];
  const f = (p) => p.map((v) => v.toFixed(1)).join(' ');
  const outC = [outP[0] - 90 * u[0], outP[1] - 90 * u[1]], inC = [inP[0] - 50 * u[0], inP[1] - 50 * u[1]];
  return `<g fill="none" stroke="${fill}" stroke-width="${sw}">
    <path d="${arc(140, 232)}" stroke-linecap="round"/>
    <path d="${arc(T0 - 0.3, 83)}" stroke-linecap="butt"/>
  </g>
  <g fill="${fill}">
    <rect x="412" y="384" width="92" height="486" rx="20"/>
    <rect x="412" y="830" width="40" height="40"/>
    <path d="M504 568 L690 398 Q${f(outC)} ${f(outP)} L${f(inP)} Q${f(inC)} 784 394 L504 662 Z"/>
    <path d="M546 660 L604 606 Q620 592 636 608 L868 846 Q884 866 860 882 L784 882 Q770 882 760 870 Z"/>
    <circle cx="${dot[0].toFixed(1)}" cy="${dot[1].toFixed(1)}" r="46"/>
  </g>`;
}

// Caja del símbolo medida con sharp (para centrarlo de verdad).
async function bbox(sw) {
  const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254" width="1254" height="1254">${mark('#fff', sw)}</svg>`;
  const { info } = await sharp(Buffer.from(raw)).trim().toBuffer({ resolveWithObject: true });
  return { x: -info.trimOffsetLeft, y: -info.trimOffsetTop, w: info.width, h: info.height };
}

const out = (n) => 'kit/' + n;
mkdirSync('kit', { recursive: true });

// Símbolo en un cuadrado, con padding relativo; fondo y esquinas redondeadas opcionales.
function squareSvg(box, { pad = 0.14, fill = C.cyan, bg = null, radius = 0, sw = 30 } = {}) {
  const side = Math.max(box.w, box.h) / (1 - 2 * pad);
  const x0 = box.x + box.w / 2 - side / 2, y0 = box.y + box.h / 2 - side / 2;
  const back = bg ? `<rect x="${x0}" y="${y0}" width="${side}" height="${side}" rx="${side * radius}" fill="${bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0.toFixed(1)} ${y0.toFixed(1)} ${side.toFixed(1)} ${side.toFixed(1)}">${back}${mark(fill, sw)}</svg>`;
}

// Composición: símbolo a la izquierda + "kosmovia" (y lema opcional abajo), sobre fondo.
function lockupSvg(box, W, H, { markH, tag = null, bg = C.bg } = {}) {
  const s = markH / box.h;
  const fs = markH * 0.62;
  const textW = fs * 4.3; // ancho aproximado de "kosmovia"
  const gap = markH * 0.28;
  const total = box.w * s + gap + textW;
  const mx = (W - total) / 2, my = (H - markH) / 2 - (tag ? fs * 0.45 : 0);
  const tx = mx + box.w * s + gap, baseline = my + markH * 0.5 + fs * 0.34;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${bg}"/>
  <g transform="translate(${mx} ${my}) scale(${s}) translate(${-box.x} ${-box.y})">${mark()}</g>
  <text x="${tx}" y="${baseline}" font-family="${FONT}" font-weight="700" font-size="${fs}" fill="${C.fg}">kosmovia</text>
  ${tag ? `<text x="${W / 2}" y="${my + markH + fs * 0.95}" text-anchor="middle" font-family="${FONT}" font-size="${fs * 0.36}" fill="${C.muted}">${tag}</text>` : ''}
</svg>`;
}

const box = await bbox(30);
const boxThick = await bbox(44);
const svgs = {
  'kosmovia-mark.svg': squareSvg(box, { pad: 0.06 }),
  'kosmovia-mark-white.svg': squareSvg(box, { pad: 0.06, fill: C.fg }),
  'kosmovia-icon.svg': squareSvg(boxThick, { pad: 0.16, bg: C.bg, radius: 0.22, sw: 44 }),
};
for (const [n, s] of Object.entries(svgs)) writeFileSync(out(n), s);

const png = (svg, w, file) => sharp(Buffer.from(svg), { density: 300 }).resize(w, w).png().toFile(out(file));
const iconFull = squareSvg(boxThick, { pad: 0.16, bg: C.bg, sw: 44 }); // sin esquinas: las redes recortan solas

await png(svgs['kosmovia-mark.svg'], 1024, 'kosmovia-mark-1024.png');
await png(svgs['kosmovia-mark-white.svg'], 1024, 'kosmovia-mark-white-1024.png');
await png(svgs['kosmovia-icon.svg'], 512, 'icon-512.png');
await png(svgs['kosmovia-icon.svg'], 192, 'icon-192.png');
await png(iconFull, 180, 'apple-icon-180.png');
await png(svgs['kosmovia-icon.svg'], 32, 'favicon-32.png');
await png(iconFull, 1080, 'perfil-redes-1080.png');

const tag = 'Comunidades con wallet y pagos en Stellar';
const big = (W, H, markH, t) => sharp(Buffer.from(lockupSvg(box, W, H, { markH, tag: t }))).png();
await big(1200, 630, 190, tag).toFile(out('og-1200x630.png'));
await big(1500, 500, 150, null).toFile(out('banner-x-1500x500.png'));
await big(1584, 396, 120, null).toFile(out('banner-linkedin-1584x396.png'));
await big(1600, 600, 220, null).toFile(out('logo-horizontal-1600x600.png'));

// Hoja para revisar tamaños chicos (no es parte del kit).
const sizes = [16, 32, 48, 64, 128];
const tiles = await Promise.all(sizes.map((s) => sharp(Buffer.from(svgs['kosmovia-icon.svg']), { density: 300 }).resize(s, s).png().toBuffer()));
let x = 20;
const comps = tiles.map((input, i) => { const c = { input, left: x, top: 20 }; x += sizes[i] + 24; return c; });
await sharp({ create: { width: x, height: 168, channels: 4, background: '#1b2633' } }).composite(comps).png().toFile('_tamanos.png');
console.log('ok', box, boxThick);
