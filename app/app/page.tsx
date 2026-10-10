import { redirect } from 'next/navigation';

/**
 * La portada pública vive en el sitio de Vercel (landing y pitch), para que haya
 * una sola. Esta app (Render) es la plataforma: su "/" lleva allá, y el botón
 * "Ingresar" de la landing vuelve a /login de esta app.
 * NEXT_PUBLIC_LANDING_URL permite cambiar la dirección sin tocar código.
 */
const SITE_URL = (process.env.NEXT_PUBLIC_LANDING_URL ?? 'https://kosmovia.vercel.app').replace(/\/$/, '');

export default function Home() {
  redirect(SITE_URL);
}
