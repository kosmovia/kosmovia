import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconComunidades(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M2 20c0-3 2.5-5 6-5s6 2 6 5" />
      <path d="M10 20c0-2.5 2-4.5 6-4.5s6 2 6 4.5" />
    </svg>
  );
}

export function IconWallet(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <path d="M16 14h2" />
    </svg>
  );
}

export function IconPerfil(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.5 3.5-6 8-6s8 2.5 8 6" />
    </svg>
  );
}
