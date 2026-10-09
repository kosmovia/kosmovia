import Link from 'next/link';

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav className="site-footer-links" aria-label="Información y ayuda">
        <Link href="/terminos">Términos</Link>
        <Link href="/privacidad">Privacidad</Link>
        <Link href="/ayuda">Ayuda</Link>
      </nav>
      <p>Redes: pronto</p>
      <p>Kosmovia © 2026 · Beta en testnet · Sin dinero real</p>
    </footer>
  );
}
