import type { Metadata, Viewport } from 'next';
import AprendeApp from './AprendeApp';

export const metadata: Metadata = {
  title: 'Aprende Stellar',
  description: 'Aprende cómo funciona el dinero en Stellar con lecciones de 2 minutos y gana insignias.',
};
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, maximumScale: 5,
  userScalable: true, themeColor: '#101A33',
};
export default function Page() { return <AprendeApp />; }
