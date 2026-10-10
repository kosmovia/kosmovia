import Link from 'next/link';
import { SOCIAL_LINKS, TRUST_LINKS } from '../lib/trust-links';

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav className="site-footer-links" aria-label="Información y ayuda">
        {TRUST_LINKS.map(link => <Link key={link.href} href={link.href}>{link.label}</Link>)}
      </nav>
      <nav className="site-footer-links" aria-label="Redes y comunidad">
        {SOCIAL_LINKS.map(link => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${link.label} (se abre en una pestaña nueva)`}
          >
            {link.label} <span aria-hidden="true">↗</span>
          </a>
        ))}
      </nav>
      <p>Kosmovia © 2026 · Beta en testnet · Sin dinero real</p>
    </footer>
  );
}
