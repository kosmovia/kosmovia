/** Logo de Retos: una X amarilla y una O coral chocando sobre una ficha violeta. */
export default function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Retos" focusable="false">
      <rect x="2" y="2" width="60" height="60" rx="18" fill="#3f1d91" />
      <rect x="2" y="2" width="60" height="60" rx="18" fill="none" stroke="#6d45d6" strokeWidth="2" />
      <g stroke="#ffd83d" strokeWidth="7" strokeLinecap="round">
        <path d="M13 15 L30 32" />
        <path d="M30 15 L13 32" />
      </g>
      <circle cx="41" cy="42" r="10.5" fill="none" stroke="#ff7a66" strokeWidth="7" />
      <path d="M44 9 L38 21 H46 L40 31" fill="none" stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
    </svg>
  );
}
