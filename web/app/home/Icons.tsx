import type { ReactNode } from "react";

const base = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const wrap = (children: ReactNode) => <svg {...base}>{children}</svg>;

export const IconChat = () =>
  wrap(
    <>
      <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z" />
      <path d="M8 10h8M8 13.5h5" />
    </>,
  );
export const IconWallet = () =>
  wrap(
    <>
      <rect x="3" y="6" width="18" height="13" rx="3" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14.5" r="1" />
    </>,
  );
export const IconPin = () =>
  wrap(
    <>
      <rect x="5" y="10" width="14" height="10" rx="2.5" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
      <path d="M9.5 15h.01M12 15h.01M14.5 15h.01" strokeWidth="2.6" />
    </>,
  );
export const IconApps = () =>
  wrap(
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
      <path d="M16.75 13.5v6.5M13.5 16.75H20" />
    </>,
  );
export const IconInstall = () =>
  wrap(
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M12 7.5v6m0 0l-2.5-2.5M12 13.5l2.5-2.5M10.5 18h3" />
    </>,
  );
export const IconShield = () =>
  wrap(
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </>,
  );
export const IconCreators = () =>
  wrap(
    <>
      <path d="M12 3l2.4 5 5.6.8-4 3.9.9 5.5L12 15.6 7.1 18.2 8 12.7 4 8.8 9.6 8z" />
    </>,
  );
export const IconFriends = () =>
  wrap(
    <>
      <circle cx="9" cy="8.5" r="3" />
      <circle cx="17" cy="9.5" r="2.4" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M15.5 14.4c2.6-.2 5 1.4 5 4.2" />
    </>,
  );
export const IconLearn = () =>
  wrap(
    <>
      <path d="M2.5 9.5L12 5l9.5 4.5L12 14 2.5 9.5z" />
      <path d="M6.5 11.8v4.2c0 1.2 2.5 2.5 5.5 2.5s5.5-1.3 5.5-2.5v-4.2" />
    </>,
  );
export const IconCode = () =>
  wrap(
    <>
      <path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5M13.5 5l-3 14" />
    </>,
  );
export const IconCheck = () =>
  wrap(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.3 2.4 2.4 4.6-5" />
    </>,
  );
export const IconArrow = () =>
  wrap(
    <>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </>,
  );
