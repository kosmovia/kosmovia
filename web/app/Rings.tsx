export default function Rings() {
  return (
    <div className="portal" aria-hidden="true">
      <svg viewBox="0 0 800 800" className="rings" focusable="false">
        <g fill="none" stroke="var(--accent)" strokeLinecap="round">
          <circle cx="400" cy="400" r="120" strokeWidth="1.5" strokeDasharray="2 8" />
          <circle cx="400" cy="400" r="200" strokeWidth="1" strokeDasharray="6 10" />
          <circle cx="400" cy="400" r="280" strokeWidth="1" strokeDasharray="1 9" />
          <circle cx="400" cy="400" r="360" strokeWidth="1" strokeDasharray="10 14" />
        </g>
      </svg>
    </div>
  );
}
