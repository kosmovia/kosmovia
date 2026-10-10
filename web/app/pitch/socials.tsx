// Redes oficiales de Kosmovia (las usa la diapositiva de cierre del pitch).
import type { ReactNode } from "react";

export const SOCIALS: { name: string; handle: string; href: string; path: ReactNode }[] = [
  { name: "Telegram", handle: "kosmovia_official", href: "https://t.me/kosmovia_official", path: <path d="M21.5 4.2 2.9 11.4c-.9.3-.9 1.1-.2 1.4l4.7 1.5 1.8 5.6c.2.6.9.8 1.3.4l2.6-2.4 4.9 3.6c.6.4 1.3.1 1.5-.6l3.2-15.2c.2-.9-.5-1.5-1.2-1.5zM8.6 13.6l9.1-5.7c.4-.3.8.2.4.5l-7 6.3-.3 3.3-2.2-4.4z" /> },
  { name: "Instagram", handle: "kosmovia.io", href: "https://www.instagram.com/kosmovia.io/", path: <><rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" strokeWidth="1.9" /><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.9" /><circle cx="17" cy="7" r="1.2" /></> },
  { name: "TikTok", handle: "@kosmovia0", href: "https://www.tiktok.com/@kosmovia0", path: <path d="M16.6 2h-3.2v13.2a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9.1a6.1 6.1 0 1 0 5.2 6V8.6a7.8 7.8 0 0 0 4.4 1.4V6.8A4.7 4.7 0 0 1 16.6 2z" /> },
  { name: "X", handle: "@kosmoviaio", href: "https://x.com/kosmoviaio", path: <path d="M17.8 3h3L14.2 10.6 22 21h-6.1l-4.8-6.3L5.6 21h-3l7.1-8.1L2.2 3h6.2l4.3 5.7zm-1 16.2h1.7L7.5 4.7H5.7z" /> },
  { name: "GitHub", handle: "kosmovia/kosmovia", href: "https://github.com/kosmovia/kosmovia", path: <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.19-1.49 3.16-1.18 3.16-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z" /> },
];
