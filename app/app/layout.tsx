import type { Metadata, Viewport } from 'next';
import './globals.css';
import { CoreProviders } from '../components/CoreProviders';
import { ServiceWorkerRegister } from '../components/ServiceWorkerRegister';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kosmovia.onrender.com'),
  title: 'Kosmovia · Comunidades y Chat',
  description: 'Plataforma de comunidades descentralizada para Stellar. Explora, conecta y pertenece.',
  // App instalable: el manifiesto sale de app/manifest.ts; en iPhone se usa el ícono de inicio.
  icons: { apple: '/icons/icon-180.png' },
  appleWebApp: { capable: true, title: 'Kosmovia', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#05080C',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Aplica el tema guardado antes de pintar, para que no haya parpadeo. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('kosmovia-theme');if(t==='negro'||t==='kosmovia')document.documentElement.setAttribute('data-theme',t)}catch(e){}",
          }}
        />
      </head>
      <body>
        <ServiceWorkerRegister />
        <CoreProviders>{children}</CoreProviders>
      </body>
    </html>
  );
}
