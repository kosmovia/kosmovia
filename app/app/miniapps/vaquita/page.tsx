import type { Metadata, Viewport } from 'next';
import VaquitaApp from './VaquitaApp';

export const metadata: Metadata = {
  title: 'Vaquita',
  description: 'Junten dinero para algo en común, fácil y transparente.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: '#FFF6E8',
};

export default function Page() {
  return <VaquitaApp />;
}
