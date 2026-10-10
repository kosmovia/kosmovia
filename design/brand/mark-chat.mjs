// Kosmovia · símbolo "planeta-chat": un globo de chat que es un planeta, con la K
// calada, un anillo inclinado y tres cuerpos en órbita (una moneda $ cripto y dos
// planetas). Todo en un solo color; los huecos son máscaras, así el símbolo sirve
// sobre fondo transparente. Sistema de coordenadas: 1000 × 1000.

// Planeta (globo de chat).
const P = { cx: 500, cy: 470, r: 250 };
// Anillo: elipse girada.
const R = { cx: 500, cy: 520, rx: 430, ry: 92, rot: -13, sw: 22 };
const GAP = 14; // aire entre piezas que se cruzan

const rad = (d) => (d * Math.PI) / 180;
const u = [Math.cos(rad(R.rot)), Math.sin(rad(R.rot))];
const v = [-Math.sin(rad(R.rot)), Math.cos(rad(R.rot))];
export const ringPt = (deg) => {
  const t = rad(deg);
  return [R.cx + R.rx * Math.cos(t) * u[0] + R.ry * Math.sin(t) * v[0], R.cy + R.rx * Math.cos(t) * u[1] + R.ry * Math.sin(t) * v[1]];
};
const arcPath = (t0, t1, n = 120) => {
  let d = '';
  for (let i = 0; i <= n; i++) {
    const [x, y] = ringPt(t0 + ((t1 - t0) * i) / n);
    d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }
  return d;
};

// Cola del globo, abajo a la izquierda.
const onCircle = (deg) => [P.cx + P.r * Math.cos(rad(deg)), P.cy + P.r * Math.sin(rad(deg))];
function bubblePath() {
  const [ax, ay] = onCircle(132), [bx, by] = onCircle(104);
  return `M${P.cx - P.r} ${P.cy} A${P.r} ${P.r} 0 1 1 ${P.cx - P.r} ${P.cy + 0.01} Z M${ax.toFixed(1)} ${ay.toFixed(1)} Q${(ax - 4).toFixed(1)} ${(ay + 70).toFixed(1)} ${(ax - 62).toFixed(1)} ${(ay + 118).toFixed(1)} Q${(ax - 70).toFixed(1)} ${(ay + 128).toFixed(1)} ${(ax - 52).toFixed(1)} ${(ay + 126).toFixed(1)} Q${(bx - 40).toFixed(1)} ${(by + 40).toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)} Z`;
}

// K calada (centrada un poco arriba, para que el anillo pase por debajo sin tocarla).
const K = 'M398 318 H462 V427 L568 318 H648 L530 438 L652 566 H571 L487 476 L462 502 V566 H398 Z';

// Cuerpos sobre el anillo: t (grados en la elipse), radio y tipo.
export const BODIES = [
  { t: -38, r: 66, kind: 'coin' }, // arriba a la derecha, el más grande
  { t: 192, r: 44, kind: 'planet' }, // izquierda
  { t: 30, r: 28, kind: 'planet' }, // abajo a la derecha
];

// Moneda cripto: disco con aro calado, 4 muescas y $ calado (todo trazos, sin fuentes).
function coinHoles(x, y, r) {
  const ring = `<circle cx="${x}" cy="${y}" r="${r * 0.74}" fill="none" stroke="#000" stroke-width="${r * 0.09}"/>`;
  const notches = [0, 90, 180, 270]
    .map((a) => {
      const [nx, ny] = [x + Math.cos(rad(a)) * r * 0.87, y + Math.sin(rad(a)) * r * 0.87];
      const w = r * 0.1, h = r * 0.2;
      return `<rect x="${nx - w / 2}" y="${ny - h / 2}" width="${w}" height="${h}" fill="#000" transform="rotate(${a + 90} ${nx} ${ny})"/>`;
    })
    .join('');
  const s = r * 0.3; // medio alto de la S
  const sw = r * 0.12;
  const S = `M${x + s * 0.62} ${y - s * 0.62} C${x + s * 0.3} ${y - s * 0.98} ${x - s * 0.72} ${y - s * 0.9} ${x - s * 0.62} ${y - s * 0.32} C${x - s * 0.5} ${y + s * 0.15} ${x + s * 0.62} ${y - s * 0.05} ${x + s * 0.62} ${y + s * 0.42} C${x + s * 0.68} ${y + s * 0.95} ${x - s * 0.4} ${y + s * 1.0} ${x - s * 0.66} ${y + s * 0.6}`;
  const dollar = `<path d="${S}" fill="none" stroke="#000" stroke-width="${sw}" stroke-linecap="round"/><path d="M${x} ${y - s * 1.32} V${y + s * 1.32}" stroke="#000" stroke-width="${sw}" stroke-linecap="round"/>`;
  return ring + notches + dollar;
}

let uid = 0;
/** Elementos SVG del símbolo en `fill`. */
export function markChat(fill = '#00F2FE', opts = {}) {
  const sw = opts.sw ?? R.sw;
  const id = `kc${uid++}`;
  const front = arcPath(8, 172); // mitad de adelante (abajo)
  const back = arcPath(172, 368);
  const bodies = BODIES.map((b) => ({ ...b, xy: ringPt(b.t) }));
  const bodyGaps = bodies.map(({ xy: [x, y], r }) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r + GAP}" fill="#000"/>`).join('');
  const whole = `x="-500" y="-500" width="2000" height="2000"`;
  return `<defs>
    <mask id="${id}p" maskUnits="userSpaceOnUse" ${whole}>
      <rect ${whole} fill="#fff"/>
      <path d="${K}" fill="#000"/>
      <path d="${front}" fill="none" stroke="#000" stroke-width="${sw + GAP * 2}"/>
      ${bodyGaps}
    </mask>
    <mask id="${id}r" maskUnits="userSpaceOnUse" ${whole}>
      <rect ${whole} fill="#fff"/>
      ${bodyGaps}
    </mask>
    <mask id="${id}b" maskUnits="userSpaceOnUse" ${whole}>
      <rect ${whole} fill="#fff"/>
      <circle cx="${P.cx}" cy="${P.cy}" r="${P.r + GAP}" fill="#000"/>
      ${bodyGaps}
    </mask>
    <mask id="${id}c" maskUnits="userSpaceOnUse" ${whole}>
      <rect ${whole} fill="#fff"/>
      ${bodies.filter((b) => b.kind === 'coin').map(({ xy: [x, y], r }) => coinHoles(x, y, r)).join('')}
    </mask>
  </defs>
  <path d="${back}" fill="none" stroke="${fill}" stroke-width="${sw}" stroke-linecap="round" mask="url(#${id}b)"/>
  <path d="${bubblePath()}" fill="${fill}" fill-rule="nonzero" mask="url(#${id}p)"/>
  <path d="${front}" fill="none" stroke="${fill}" stroke-width="${sw}" stroke-linecap="round" mask="url(#${id}r)"/>
  <g fill="${fill}" mask="url(#${id}c)">
    ${bodies.map(({ xy: [x, y], r }) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"/>`).join('')}
  </g>`;
}
