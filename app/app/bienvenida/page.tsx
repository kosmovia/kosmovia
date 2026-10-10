import type { Metadata } from 'next';
import { TrustWelcome } from '../../components/TrustWelcome';

export const metadata: Metadata = { title: 'Bienvenido · Kosmovia', description: 'Conoce Kosmovia, su guía, términos, privacidad y comunidad oficial.' };

export default function WelcomePage() {
  return <TrustWelcome />;
}
