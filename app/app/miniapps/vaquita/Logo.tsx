/** Vaquita: cara de vaca simpática. Decorativa (el nombre va en el texto al lado). */
export default function Logo({ size = 64, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="vq-head">
          <ellipse cx="60" cy="62" rx="36" ry="33" />
        </clipPath>
      </defs>
      {/* cuernitos */}
      <path d="M33 34 C28 22 32 15 40 14 C40 21 43 27 46 31 Z" fill="#F2A03D" stroke="#4A2A1A" strokeWidth="3" strokeLinejoin="round" />
      <path d="M87 34 C92 22 88 15 80 14 C80 21 77 27 74 31 Z" fill="#F2A03D" stroke="#4A2A1A" strokeWidth="3" strokeLinejoin="round" />
      {/* orejas */}
      <ellipse cx="22" cy="55" rx="14" ry="9" transform="rotate(-20 22 55)" fill="#C8552B" stroke="#4A2A1A" strokeWidth="3" />
      <ellipse cx="98" cy="55" rx="14" ry="9" transform="rotate(20 98 55)" fill="#C8552B" stroke="#4A2A1A" strokeWidth="3" />
      {/* cabeza */}
      <ellipse cx="60" cy="62" rx="36" ry="33" fill="#FFFAF2" />
      <g clipPath="url(#vq-head)">
        <ellipse cx="38" cy="42" rx="17" ry="15" fill="#C8552B" />
        <ellipse cx="88" cy="50" rx="9" ry="11" fill="#C8552B" />
      </g>
      <ellipse cx="60" cy="62" rx="36" ry="33" fill="none" stroke="#4A2A1A" strokeWidth="3" />
      {/* ojos */}
      <circle cx="47" cy="58" r="4.6" fill="#4A2A1A" />
      <circle cx="73" cy="58" r="4.6" fill="#4A2A1A" />
      <circle cx="48.6" cy="56.4" r="1.5" fill="#FFFAF2" />
      <circle cx="74.6" cy="56.4" r="1.5" fill="#FFFAF2" />
      {/* hocico */}
      <ellipse cx="60" cy="82" rx="21" ry="14" fill="#F7B79A" stroke="#4A2A1A" strokeWidth="3" />
      <ellipse cx="52" cy="80" rx="3" ry="4" fill="#4A2A1A" />
      <ellipse cx="68" cy="80" rx="3" ry="4" fill="#4A2A1A" />
      <path d="M53 89 Q60 94 67 89" fill="none" stroke="#4A2A1A" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
