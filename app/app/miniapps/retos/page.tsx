import type { Metadata, Viewport } from 'next';
import RetosApp from './RetosApp';

export const metadata: Metadata = {
  title: 'Retos',
  description: 'Desafía a tus amigos de la comunidad con juegos simples. Sin apuestas, solo por diversión y puntos.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: '#1b0b45',
};

export default function Page() {
  return <RetosApp />;
}
