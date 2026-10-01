// Dotted rings plus a few brighter arcs, like light falling into a portal.
const rings = [
  { r: 110, width: 2, dash: "2 7" },
  { r: 160, width: 1, dash: "1 6" },
  { r: 215, width: 1.5, dash: "6 9" },
  { r: 270, width: 1, dash: "1 8" },
  { r: 325, width: 1.5, dash: "3 10" },
  { r: 380, width: 1, dash: "12 16" },
];

const arcs = [
  { r: 135, width: 4, dash: "120 730", offset: 0 },
  { r: 240, width: 3, dash: "200 1308", offset: -500 },
  { r: 350, width: 5, dash: "160 2039", offset: -1100 },
];

export default function Rings() {
  return (
    <div className="portal" aria-hidden="true">
      <svg viewBox="0 0 800 800" className="rings" focusable="false">
        <g fill="none" stroke="var(--accent)" strokeLinecap="round">
          {rings.map((ring) => (
            <circle
              key={ring.r}
              cx="400"
              cy="400"
              r={ring.r}
              strokeWidth={ring.width}
              strokeDasharray={ring.dash}
            />
          ))}
        </g>
        <g fill="none" stroke="var(--glow)" strokeLinecap="round">
          {arcs.map((arc) => (
            <circle
              key={arc.r}
              cx="400"
              cy="400"
              r={arc.r}
              strokeWidth={arc.width}
              strokeDasharray={arc.dash}
              strokeDashoffset={arc.offset}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
