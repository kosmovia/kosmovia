import type { ReactNode } from 'react';
import Link from 'next/link';
import SiteFooter from './SiteFooter';

type LegalSection = { id: string; title: string; content: ReactNode };

export default function LegalLayout({ title, intro, draft = false, sections }: {
  title: string;
  intro: string;
  draft?: boolean;
  sections: LegalSection[];
}) {
  return (
    <div className="legal-page">
      <a className="legal-skip" href="#contenido">Ir al contenido</a>
      <header className="legal-header">
        <Link href="/" className="legal-brand" aria-label="Kosmovia: volver al inicio">
          <img src="/brand/kosmovia-mark.svg" alt="" width={28} height={28} />
          <span>Kosmovia</span>
        </Link>
        <Link href="/">Volver al inicio</Link>
      </header>
      <main id="contenido" className="legal-main" tabIndex={-1}>
        <h1>{title}</h1>
        <p className="legal-date">Última actualización: <time dateTime="2026-10-09">9 de octubre de 2026</time></p>
        {draft && (
          <aside className="legal-note" aria-label="Aviso de borrador">
            <strong>Borrador para la beta.</strong> Este documento debe ser revisado por un abogado boliviano antes de pasar a mainnet (la red con dinero real).
          </aside>
        )}
        <p>{intro}</p>
        <nav className="legal-toc" aria-label="Contenido de esta página">
          <h2>En esta página</h2>
          <ul>{sections.map(section => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ul>
        </nav>
        {sections.map(section => (
          <section className="legal-section" id={section.id} key={section.id} aria-labelledby={`${section.id}-titulo`}>
            <h2 id={`${section.id}-titulo`}>{section.title}</h2>
            {section.content}
          </section>
        ))}
      </main>
      <SiteFooter />
    </div>
  );
}
