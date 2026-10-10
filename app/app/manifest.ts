import type { MetadataRoute } from 'next';

/** Manifiesto de la app instalable (PWA). Next lo sirve en /manifest.webmanifest. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Kosmovia',
    short_name: 'Kosmovia',
    description: 'Comunidades y chat para la comunidad Stellar.',
    lang: 'es',
    start_url: '/plataforma',
    scope: '/',
    display: 'standalone',
    background_color: '#05080C',
    theme_color: '#05080C',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
