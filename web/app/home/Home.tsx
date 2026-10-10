import Link from "next/link";
import type { ReactNode } from "react";
import "./landing.css";
import CosmicScene from "./CosmicScene";
import Nav from "./Nav";
import {
  IconApps,
  IconArrow,
  IconChat,
  IconCheck,
  IconCode,
  IconCreators,
  IconFriends,
  IconInstall,
  IconLearn,
  IconPin,
  IconShield,
  IconWallet,
} from "./Icons";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://kosmovia.onrender.com").replace(/\/$/, "");
const LOGIN = `${APP_URL}/login`;

const NAV = [
  { href: "#que-es", label: "Qué es" },
  { href: "#como-funciona", label: "Cómo funciona" },
  { href: "#mini-apps", label: "Mini-apps" },
  { href: "#seguridad", label: "Seguridad" },
  { href: "#roadmap", label: "Roadmap" },
  { href: "/pitch", label: "Pitch", page: true },
];

const ROADMAP = [
  {
    stage: "Hecho · octubre 2026",
    status: "done",
    title: "La base, funcionando",
    items: [
      "Comunidades, canales, mensajes directos y archivos",
      "Wallet en USDC y pagos a cualquier @usuario",
      "PIN de pagos, límite diario y aviso de pagos sin PIN",
      "Mini-apps: Vaquita, Retos y Aprende Stellar",
      "App instalable y notificaciones",
    ],
  },
  {
    stage: "Próximo",
    status: "next",
    title: "Comunidades que cobran",
    items: [
      "Chat en tiempo real",
      "Bot puente con Telegram: cobra el acceso a tu grupo",
      "Membresías de pago",
      "Pasanaku con contrato en Soroban",
      "SDK para que otros creen mini-apps",
    ],
  },
  {
    stage: "Antes de mainnet",
    status: "later",
    title: "Listo para dinero real",
    items: [
      "Auditoría de seguridad externa",
      "Revisión legal de términos y privacidad",
      "Confirmación del PIN en la firma de la wallet",
      "De Bolivia a Latinoamérica",
    ],
  },
] as const;

const FEATURES: { icon: ReactNode; title: string; text: string }[] = [
  {
    icon: <IconChat />,
    title: "Comunidades y chat",
    text: "Canales, categorías, canales privados, mensajes directos, archivos e imágenes. Tu comunidad en un solo lugar.",
  },
  {
    icon: <IconWallet />,
    title: "Wallet en dólares digitales",
    text: "Entras con Google o email y tienes tu wallet de USDC lista, sin frase semilla.",
  },
  {
    icon: <IconPin />,
    title: "Pagos con PIN",
    text: "Paga a cualquier @usuario, cobra dentro del chat y guarda comprobantes verificables en Stellar.",
  },
  {
    icon: <IconApps />,
    title: "Mini-apps",
    text: "Vaquita para juntar dinero, Retos para jugar con amigos y Aprende Stellar para aprender sin complicarte.",
  },
  {
    icon: <IconInstall />,
    title: "App instalable y notificaciones",
    text: "Instálala en tu celular como una app y recibe avisos de mensajes y pagos.",
  },
  {
    icon: <IconShield />,
    title: "Seguridad",
    text: "PIN de 6 dígitos, límite diario y un aviso cuando se hacen pagos sin PIN.",
  },
];

const STEPS = [
  { n: "1", title: "Entra con Google o email", text: "Se crea tu cuenta y tu wallet en segundos. No necesitas instalar nada ni saber de cripto." },
  { n: "2", title: "Únete o crea tu comunidad", text: "Entra a una comunidad existente o crea la tuya con sus canales, categorías y roles." },
  { n: "3", title: "Chatea, paga y usa mini-apps", text: "Conversa, envía o cobra dólares digitales con tu PIN y juega o ahorra con tus amigos." },
];

const SOON = ["Pasanaku", "Dividir la cuenta", "Propinas para creadores", "Membresías", "Talento"];

const AUDIENCE = [
  { icon: <IconCreators />, title: "Creadores y comunidades que cobran", text: "Cursos, mentorías y academias: reúne a tu gente y cobra dentro del mismo chat." },
  { icon: <IconFriends />, title: "Grupos de amigos y familia", text: "Hagan vaquitas, páguense entre ustedes y mantengan las cuentas claras." },
  { icon: <IconLearn />, title: "Quien quiere aprender Stellar", text: "Lecciones cortas, misiones e insignias para entender Stellar usándolo." },
];

const SAFETY = [
  "PIN de 6 dígitos para confirmar tus pagos.",
  "Límite diario de pagos y aviso si se hacen pagos sin PIN.",
  "Beta en Stellar testnet: no se usa dinero real.",
  "Tu wallet la custodia Pollar si entras con Google o email. También puedes conectar tu propia wallet Freighter.",
];

const FAQ = [
  { q: "¿Es dinero real?", a: "No. Kosmovia está en beta sobre Stellar testnet, la red de pruebas. Los dólares digitales que ves son de prueba y no tienen valor real." },
  { q: "¿Cuánto cuesta?", a: "Es gratis durante la beta." },
  { q: "¿Quién guarda mi wallet?", a: "Si entras con Google o email, tu wallet la custodia Pollar, nuestro proveedor de wallets, y no necesitas frase semilla. Si prefieres, puedes conectar tu propia wallet Freighter." },
  { q: "¿Necesito saber de cripto?", a: "No. Entras con Google o email y usas Kosmovia como una app de chat y pagos. Si te da curiosidad, Aprende Stellar te explica lo básico en lecciones de 2 minutos." },
  { q: "¿Qué es USDC?", a: "Es un dólar digital: una moneda diseñada para valer siempre 1 dólar. En la beta usas USDC de prueba." },
];

const SOCIALS = [
  { name: "Telegram", href: "https://t.me/kosmovia_official", path: <path d="M21.5 4.2 2.9 11.4c-.9.3-.9 1.1-.2 1.4l4.7 1.5 1.8 5.6c.2.6.9.8 1.3.4l2.6-2.4 4.9 3.6c.6.4 1.3.1 1.5-.6l3.2-15.2c.2-.9-.5-1.5-1.2-1.5zM8.6 13.6l9.1-5.7c.4-.3.8.2.4.5l-7 6.3-.3 3.3-2.2-4.4z" /> },
  { name: "Instagram", href: "https://www.instagram.com/kosmovia.io/", path: <><rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" strokeWidth="1.9" /><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.9" /><circle cx="17" cy="7" r="1.2" /></> },
  { name: "TikTok", href: "https://www.tiktok.com/@kosmovia0", path: <path d="M16.6 2h-3.2v13.2a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9.1a6.1 6.1 0 1 0 5.2 6V8.6a7.8 7.8 0 0 0 4.4 1.4V6.8A4.7 4.7 0 0 1 16.6 2z" /> },
  { name: "X", href: "https://x.com/kosmoviaio", path: <path d="M17.8 3h3L14.2 10.6 22 21h-6.1l-4.8-6.3L5.6 21h-3l7.1-8.1L2.2 3h6.2l4.3 5.7zm-1 16.2h1.7L7.5 4.7H5.7z" /> },
  { name: "GitHub", href: "https://github.com/kosmovia/kosmovia", path: <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.19-1.49 3.16-1.18 3.16-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z" /> },
];

function Socials({ label }: { label: string }) {
  return (
    <ul className="kv-socials" aria-label={label}>
      {SOCIALS.map((s) => (
        <li key={s.name}>
          <a href={s.href} target="_blank" rel="noopener noreferrer" aria-label={`${s.name} de Kosmovia (se abre en una pestaña nueva)`} title={s.name}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              {s.path}
            </svg>
          </a>
        </li>
      ))}
    </ul>
  );
}

function Mini({ cls, tag, name, text, art }: { cls: string; tag: string; name: string; text: string; art: ReactNode }) {
  return (
    <article className={`kv-mini ${cls}`}>
      <div className="kv-mini-art" aria-hidden="true">
        {art}
      </div>
      <p className="kv-mini-tag">{tag}</p>
      <h3>{name}</h3>
      <p>{text}</p>
    </article>
  );
}

export default function Home() {
  return (
    <div className="kv-root" id="inicio">
      <a className="kv-skip" href="#contenido">
        Saltar al contenido
      </a>
      <Nav items={NAV} loginUrl={LOGIN} />

      <main id="contenido">
        {/* Hero */}
        <section className="kv-hero">
          <div className="kv-wrap kv-hero-grid">
            <div className="kv-hero-copy">
              <h1>
                Tu comunidad y tu dinero, <span>en un solo lugar.</span>
              </h1>
              <p className="kv-lead">
                Chat, wallet en dólares digitales (USDC) y pagos entre personas sobre Stellar. Hecho en Bolivia, para el mundo.
              </p>
              <div className="kv-cta-row">
                <a className="kv-btn kv-btn-primary kv-btn-lg" href={LOGIN}>
                  Ingresar
                </a>
                <a className="kv-btn kv-btn-ghost kv-btn-lg" href="#como-funciona">
                  Cómo funciona
                </a>
              </div>
              <p className="kv-note">
                <span className="kv-dot" aria-hidden="true" /> Beta gratis · Stellar testnet
              </p>
            </div>
            <CosmicScene />
          </div>
        </section>

        {/* Qué puedes hacer */}
        <section id="que-es" className="kv-section">
          <div className="kv-wrap">
            <p className="kv-eyebrow">Qué es</p>
            <h2>Qué puedes hacer en Kosmovia</h2>
            <p className="kv-sub">Una app donde conversas con tu comunidad y mueves dinero sin salir del chat.</p>
            <div className="kv-grid kv-grid-3">
              {FEATURES.map((f) => (
                <article key={f.title} className="kv-card">
                  <div className="kv-icon">{f.icon}</div>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Cómo funciona */}
        <section id="como-funciona" className="kv-section kv-alt">
          <div className="kv-wrap">
            <p className="kv-eyebrow">Cómo funciona</p>
            <h2>Empieza en tres pasos</h2>
            <ol className="kv-steps">
              {STEPS.map((s) => (
                <li key={s.n} className="kv-step">
                  <span className="kv-step-n" aria-hidden="true">
                    {s.n}
                  </span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
            <div className="kv-center">
              <a className="kv-btn kv-btn-primary kv-btn-lg" href={LOGIN}>
                Ingresar
              </a>
            </div>
          </div>
        </section>

        {/* Mini-apps */}
        <section id="mini-apps" className="kv-section">
          <div className="kv-wrap">
            <p className="kv-eyebrow">Mini-apps</p>
            <h2>Apps pequeñas dentro de tu comunidad</h2>
            <p className="kv-sub">Al estilo Farcaster: cada mini-app tiene su propia identidad y vive dentro de Kosmovia.</p>
            <div className="kv-grid kv-grid-3">
              <Mini
                cls="kv-mini-vaquita"
                tag="Ahorro en grupo"
                name="Vaquita"
                text="Junten dinero para algo en común."
                art={
                  <svg viewBox="0 0 120 70" width="120" height="70">
                    <rect x="8" y="30" width="104" height="14" rx="7" fill="#B84A26" opacity=".18" />
                    <rect x="8" y="30" width="68" height="14" rx="7" fill="#B84A26" />
                    <circle cx="30" cy="14" r="9" fill="none" stroke="#B84A26" strokeWidth="3" />
                    <circle cx="60" cy="14" r="9" fill="none" stroke="#B84A26" strokeWidth="3" />
                    <circle cx="90" cy="14" r="9" fill="none" stroke="#B84A26" strokeWidth="3" strokeDasharray="4 4" />
                    <path d="M8 60h104" stroke="#B84A26" strokeWidth="3" strokeLinecap="round" opacity=".4" />
                  </svg>
                }
              />
              <Mini
                cls="kv-mini-retos"
                tag="Juegos"
                name="Retos"
                text="Juega con tus amigos: tres en raya y piedra, papel o tijera. Sin apuestas."
                art={
                  <svg viewBox="0 0 120 70" width="120" height="70" fill="none" strokeLinecap="round" strokeWidth="4">
                    <path d="M44 6v58M76 6v58M18 24h84M18 46h84" stroke="#FACC15" opacity=".55" />
                    <path d="M24 10l14 10M38 10 24 20" stroke="#FACC15" />
                    <circle cx="60" cy="35" r="7" stroke="#fff" />
                    <circle cx="92" cy="57" r="6" stroke="#fff" />
                  </svg>
                }
              />
              <Mini
                cls="kv-mini-aprende"
                tag="Aprendizaje"
                name="Aprende Stellar"
                text="Lecciones de 2 minutos, misiones e insignias."
                art={
                  <svg viewBox="0 0 120 70" width="120" height="70" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3">
                    <path d="M60 8l6 13 14 2-10 10 2 14-12-7-12 7 2-14-10-10 14-2z" stroke="#7DB2FF" fill="#7DB2FF" fillOpacity=".2" />
                    <circle cx="22" cy="52" r="5" stroke="#7DB2FF" />
                    <circle cx="98" cy="22" r="3" fill="#7DB2FF" />
                    <path d="M30 62h60" stroke="#7DB2FF" opacity=".4" />
                  </svg>
                }
              />
            </div>

            <div className="kv-soon">
              <h3>Próximamente</h3>
              <ul>
                {SOON.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>

            <div className="kv-dev">
              <div className="kv-icon" aria-hidden="true">
                <IconCode />
              </div>
              <div>
                <h3>Para desarrolladores</h3>
                <p>Pronto podrás crear tu mini-app con nuestro SDK y publicarla tras una revisión.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Para quién */}
        <section id="para-quien" className="kv-section kv-alt">
          <div className="kv-wrap">
            <p className="kv-eyebrow">Para quién</p>
            <h2>Hecho para ti y tu gente</h2>
            <div className="kv-grid kv-grid-3">
              {AUDIENCE.map((a) => (
                <article key={a.title} className="kv-card">
                  <div className="kv-icon">{a.icon}</div>
                  <h3>{a.title}</h3>
                  <p>{a.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Seguridad */}
        <section id="seguridad" className="kv-section">
          <div className="kv-wrap kv-safety">
            <div>
              <p className="kv-eyebrow">Seguridad y confianza</p>
              <h2>Tu dinero, con cuidado</h2>
              <p className="kv-sub">Kosmovia está en beta y usa dinero de prueba. Estas protecciones ya forman parte de la app.</p>
              <p className="kv-links-inline">
                <a href={`${APP_URL}/terminos`}>Términos</a>
                <a href={`${APP_URL}/privacidad`}>Privacidad</a>
              </p>
            </div>
            <ul className="kv-checks">
              {SAFETY.map((s) => (
                <li key={s}>
                  <IconCheck />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Roadmap */}
        <section id="roadmap" className="kv-section kv-alt">
          <div className="kv-wrap">
            <p className="kv-eyebrow">Hoja de ruta</p>
            <h2>Primero Bolivia, después el mundo</h2>
            <p className="kv-sub">Lo que ya está hecho y lo que viene, sin promesas que no podamos cumplir.</p>
            <ol className="kv-grid kv-grid-3 kv-roadmap">
              {ROADMAP.map((r) => (
                <li key={r.stage} className={`kv-card kv-stage kv-stage-${r.status}`}>
                  <p className="kv-stage-label">{r.stage}</p>
                  <h3>{r.title}</h3>
                  <ul>
                    {r.items.map((it) => (
                      <li key={it}>{it}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
            <p className="kv-links-inline">
              <a href="/es/pitch#12">Ver la hoja de ruta en el pitch</a>
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section id="preguntas" className="kv-section">
          <div className="kv-wrap kv-narrow">
            <p className="kv-eyebrow">Preguntas frecuentes</p>
            <h2>Lo que más nos preguntan</h2>
            <div className="kv-faq">
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Cierre */}
        <section className="kv-section kv-close">
          <div className="kv-wrap kv-center">
            <h2>Súmate a la beta</h2>
            <p className="kv-sub">Gratis, en Stellar testnet. Entra con Google o email y prueba Kosmovia con tu comunidad.</p>
            <div className="kv-cta-row kv-cta-center">
              <a className="kv-btn kv-btn-primary kv-btn-lg" href={LOGIN}>
                Ingresar
              </a>
              <Link className="kv-btn kv-btn-ghost kv-btn-lg" href="/pitch">
                Ver el pitch <IconArrow />
              </Link>
            </div>
            <p className="kv-follow">Síguenos</p>
            <Socials label="Redes sociales de Kosmovia" />
          </div>
        </section>
      </main>

      <footer className="kv-footer">
        <div className="kv-wrap kv-footer-in">
          <div className="kv-footer-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/kosmovia-mark.svg" alt="" width={28} height={28} />
            <div>
              <strong>Kosmovia</strong>
              <p>Construido en el programa Stellar Elite Bolivia</p>
            </div>
          </div>
          <nav aria-label="Enlaces del pie" className="kv-footer-links">
            <a href={`${APP_URL}/terminos`}>Términos</a>
            <a href={`${APP_URL}/privacidad`}>Privacidad</a>
            <a href={`${APP_URL}/ayuda`}>Ayuda</a>
            <Link href="/pitch">Pitch</Link>
            <a href="https://github.com/kosmovia/kosmovia" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </nav>
          <Socials label="Redes sociales" />
        </div>
        <p className="kv-copy">© 2026 Kosmovia</p>
      </footer>
    </div>
  );
}
