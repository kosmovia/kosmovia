import { en as contentEn, es as contentEs } from "../content";
import type { Content } from "../content";

export type Item = { lead?: string; text: string; link?: string };
export type Card = { head: string; text: string };
export type Mark = { v: "yes" | "no" | "partial"; text: string };

export type Slide =
  | { kind: "cover"; title: string; tagline: string; sub: string; meta: string }
  | { kind: "list"; title: string; items: Item[] }
  | { kind: "cards"; title: string; items: Card[] }
  | { kind: "steps"; title: string; items: Item[] }
  | {
      kind: "table";
      title: string;
      caption: string;
      cols: string[];
      rows: { name: string; highlight?: boolean; cells: Mark[] }[];
    }
  | {
      kind: "roadmap";
      title: string;
      nowLabel: string;
      stages: Content["roadmap"]["stages"];
    }
  | {
      kind: "team";
      title: string;
      people: { name: string; role: string }[];
      footer: string;
    }
  | { kind: "close"; title: string; text: string; links: string[]; big: string };

export type Deck = {
  lang: "en" | "es";
  ui: {
    back: string;
    backText: string;
    backHref: string;
    prev: string;
    next: string;
    fullscreen: string;
    exitFullscreen: string;
    switchLabel: string;
    switchText: string;
    switchHref: string;
    slideOf: string; // "Slide {n} of {total}"
    deckLabel: string;
  };
  slides: Slide[];
};

export const en: Deck = {
  lang: "en",
  ui: {
    back: "Back to the Kosmovia site",
    backText: "Kosmovia",
    backHref: "/",
    prev: "Previous slide",
    next: "Next slide",
    fullscreen: "Fullscreen",
    exitFullscreen: "Exit fullscreen",
    switchLabel: "Ver en español",
    switchText: "ES",
    switchHref: "/es/pitch",
    slideOf: "Slide {n} of {total}",
    deckLabel: "Kosmovia pitch deck",
  },
  slides: [
    {
      kind: "cover",
      title: "Kosmovia",
      tagline: "Explore. Connect. Belong.",
      sub: "Communities with a wallet and payments built in, on Stellar.",
      meta: "Stellar Elite Bolivia · 2026 · kosmovia.vercel.app",
    },
    {
      kind: "list",
      title: "Communities and money live in different places",
      items: [
        {
          text: "Communities are scattered across WhatsApp, Telegram and Discord, and none of them lets you pay inside.",
        },
        {
          text: "Getting started in crypto is still hard: seed phrases, fees and separate apps.",
        },
        {
          text: "Businesses have no trusted place to reach users and builders and close deals online.",
        },
      ],
    },
    {
      kind: "cards",
      title: "One place to connect and pay",
      items: [
        {
          head: "Communities",
          text: "Channels, roles and chat, with the layout you already know.",
        },
        {
          head: "A wallet from day one",
          text: "Sign in with Google or email. USDC wallet ready, no seed phrases, fees covered.",
        },
        {
          head: "Payments and transfers",
          text: "Send money by @username, get paid with a link or QR, close deals with escrow contracts.",
        },
        {
          head: "Verified businesses",
          text: "Companies verified with KYC open their own communities and connect through an API.",
        },
      ],
    },
    {
      kind: "steps",
      title: "How it works",
      items: [
        {
          lead: "Sign in with Google or email:",
          text: "your wallet is created for you.",
        },
        { text: "Join a community, or create your own." },
        { text: "Send, request and pay in USDC, right from the chat." },
        {
          lead: "Verified businesses close deals with escrow:",
          text: "the money is released when both sides deliver.",
        },
      ],
    },
    {
      kind: "cards",
      title: "Built for real use, starting in Bolivia",
      items: [
        {
          head: "Communities and events",
          text: "Entry fees, pools and payments between members.",
        },
        {
          head: "Car dealers and real estate",
          text: "A deposit held in escrow until the car or the keys are delivered.",
        },
        {
          head: "Banks and fintechs",
          text: "A verified community to reach new users, connected through an API.",
        },
        {
          head: "Builders",
          text: "Find users and businesses, and get paid in USDC.",
        },
      ],
    },
    {
      kind: "list",
      title: "Why Stellar",
      items: [
        { text: "Fees of a fraction of a cent." },
        { text: "Payments settle in about 5 seconds." },
        { text: "USDC built in: digital dollars, not volatile tokens." },
        { text: "Smart contracts (Soroban) for escrow and split payments." },
        { text: "Anchors to move between local money and USDC." },
      ],
    },
    {
      kind: "list",
      title: "What already works",
      items: [
        {
          text: "Live website in English and Spanish",
          link: "kosmovia.vercel.app",
        },
        {
          text: "Public, open-source repository (AGPL-3.0)",
          link: "github.com/kosmovia/kosmovia",
        },
        {
          lead: "Payment rails proven:",
          text: "Alejandro built Pollar Pass, which charges in USDC on Stellar testnet with email sign-in, an on-chain receipt and a QR check-in",
          link: "pollarpass.vercel.app",
        },
        {
          lead: "Stack:",
          text: "Next.js · Pollar · Firebase · Stellar testnet",
        },
      ],
    },
    {
      kind: "table",
      title: "How we are different",
      caption:
        "Comparison of Kosmovia with WhatsApp or Discord, Telegram and Towns",
      cols: [
        "Communities",
        "Payments inside",
        "Verified businesses",
        "Free to join",
      ],
      rows: [
        {
          name: "WhatsApp / Discord",
          cells: [
            { v: "yes", text: "Yes" },
            { v: "no", text: "No" },
            { v: "no", text: "No" },
            { v: "yes", text: "Yes" },
          ],
        },
        {
          name: "Telegram",
          cells: [
            { v: "yes", text: "Yes" },
            { v: "partial", text: "Only with TON" },
            { v: "no", text: "No" },
            { v: "yes", text: "Yes" },
          ],
        },
        {
          name: "Towns",
          cells: [
            { v: "yes", text: "Yes" },
            { v: "yes", text: "Yes, with paid memberships" },
            { v: "no", text: "No" },
            { v: "partial", text: "Depends on the community" },
          ],
        },
        {
          name: "Kosmovia",
          highlight: true,
          cells: [
            { v: "yes", text: "Yes" },
            { v: "yes", text: "Yes, USDC on Stellar" },
            { v: "yes", text: "Yes, with KYC" },
            { v: "yes", text: "Yes" },
          ],
        },
      ],
    },
    {
      kind: "list",
      title: "How Kosmovia makes money",
      items: [
        { lead: "Now:", text: "grants from the Stellar Community Fund." },
        {
          lead: "Next:",
          text: "a small fee on the payments that go through the platform: transfers, payment links and escrow.",
        },
        {
          lead: "Premium tools",
          text: "for verified businesses: analytics and API access.",
        },
        {
          lead: "What we won't do:",
          text: "our own token, paid channels or ads.",
        },
      ],
    },
    {
      kind: "roadmap",
      title: "Roadmap — Bolivia first, then the world",
      nowLabel: contentEn.roadmap.nowLabel,
      stages: contentEn.roadmap.stages,
    },
    {
      kind: "team",
      title: "The team",
      people: [
        {
          name: "Alejandro",
          role: "Product and backend: wallet, payments and deploys",
        },
        { name: "Roberto", role: "Backend and business verification (KYC)" },
        { name: "Victor", role: "Frontend, UX/UI and the presentation" },
        { name: "Carla", role: "Social media, marketing and brand" },
      ],
      footer: "Stellar Elite Bolivia · TechRebel",
    },
    {
      kind: "close",
      title: "Join us",
      text: "We're looking for communities and testers in Bolivia, pilot businesses (car dealers, real estate, fintechs) and your feedback.",
      links: ["kosmovia.vercel.app", "github.com/kosmovia/kosmovia"],
      big: "Explore. Connect. Belong.",
    },
  ],
};

export const es: Deck = {
  lang: "es",
  ui: {
    back: "Volver al sitio de Kosmovia",
    backText: "Kosmovia",
    backHref: "/es",
    prev: "Diapositiva anterior",
    next: "Diapositiva siguiente",
    fullscreen: "Pantalla completa",
    exitFullscreen: "Salir de pantalla completa",
    switchLabel: "View in English",
    switchText: "EN",
    switchHref: "/pitch",
    slideOf: "Diapositiva {n} de {total}",
    deckLabel: "Presentación de Kosmovia",
  },
  slides: [
    {
      kind: "cover",
      title: "Kosmovia",
      tagline: "Explora. Conecta. Pertenece.",
      sub: "Comunidades con wallet y pagos integrados, en Stellar.",
      meta: "Stellar Elite Bolivia · 2026 · kosmovia.vercel.app",
    },
    {
      kind: "list",
      title: "Las comunidades y el dinero viven en lugares distintos",
      items: [
        {
          text: "Las comunidades están repartidas entre WhatsApp, Telegram y Discord, y en ninguna se puede pagar adentro.",
        },
        {
          text: "Empezar en cripto sigue siendo difícil: frases semilla, comisiones y apps separadas.",
        },
        {
          text: "Las empresas no tienen un lugar confiable para llegar a usuarios y builders y cerrar tratos en línea.",
        },
      ],
    },
    {
      kind: "cards",
      title: "Un solo lugar para conectar y pagar",
      items: [
        {
          head: "Comunidades",
          text: "Canales, roles y chat, con el diseño que ya conoces.",
        },
        {
          head: "Una wallet desde el primer día",
          text: "Entra con Google o email. Wallet en USDC lista, sin frases semilla y sin pagar comisiones.",
        },
        {
          head: "Pagos y envíos",
          text: "Envía dinero por @usuario, cobra con un link o QR y cierra tratos con contratos de garantía.",
        },
        {
          head: "Empresas verificadas",
          text: "Empresas verificadas con KYC abren su propia comunidad y se conectan por API.",
        },
      ],
    },
    {
      kind: "steps",
      title: "Cómo funciona",
      items: [
        {
          lead: "Entras con Google o email:",
          text: "tu wallet se crea sola.",
        },
        { text: "Te unes a una comunidad o creas la tuya." },
        { text: "Envías, cobras y pagas en USDC desde el mismo chat." },
        {
          lead: "Las empresas verificadas cierran tratos con garantía:",
          text: "el dinero se libera cuando ambas partes cumplen.",
        },
      ],
    },
    {
      kind: "cards",
      title: "Hecho para usos reales, empezando por Bolivia",
      items: [
        {
          head: "Comunidades y eventos",
          text: "Entradas, colectas y pagos entre miembros.",
        },
        {
          head: "Concesionarias e inmobiliarias",
          text: "Una seña en garantía hasta que se entrega el auto o las llaves.",
        },
        {
          head: "Bancos y fintechs",
          text: "Una comunidad verificada para llegar a nuevos usuarios, conectada por API.",
        },
        {
          head: "Builders",
          text: "Encuentran usuarios y empresas, y cobran en USDC.",
        },
      ],
    },
    {
      kind: "list",
      title: "Por qué Stellar",
      items: [
        { text: "Comisiones de fracciones de centavo." },
        { text: "Los pagos se confirman en unos 5 segundos." },
        { text: "USDC integrado: dólares digitales, no tokens volátiles." },
        {
          text: "Contratos inteligentes (Soroban) para pagos en garantía y pagos divididos.",
        },
        { text: "Anchors para pasar de moneda local a USDC y al revés." },
      ],
    },
    {
      kind: "list",
      title: "Lo que ya funciona",
      items: [
        {
          text: "Web en vivo en inglés y español",
          link: "kosmovia.vercel.app",
        },
        {
          text: "Repositorio público y open source (AGPL-3.0)",
          link: "github.com/kosmovia/kosmovia",
        },
        {
          lead: "Los pagos ya están probados:",
          text: "Alejandro construyó Pollar Pass, que cobra en USDC en testnet de Stellar con login por email, comprobante en la red y QR en la puerta",
          link: "pollarpass.vercel.app",
        },
        {
          lead: "Stack:",
          text: "Next.js · Pollar · Firebase · Stellar testnet",
        },
      ],
    },
    {
      kind: "table",
      title: "En qué nos diferenciamos",
      caption:
        "Comparación de Kosmovia con WhatsApp o Discord, Telegram y Towns",
      cols: [
        "Comunidades",
        "Pagos adentro",
        "Empresas verificadas",
        "Gratis para entrar",
      ],
      rows: [
        {
          name: "WhatsApp / Discord",
          cells: [
            { v: "yes", text: "Sí" },
            { v: "no", text: "No" },
            { v: "no", text: "No" },
            { v: "yes", text: "Sí" },
          ],
        },
        {
          name: "Telegram",
          cells: [
            { v: "yes", text: "Sí" },
            { v: "partial", text: "Solo con TON" },
            { v: "no", text: "No" },
            { v: "yes", text: "Sí" },
          ],
        },
        {
          name: "Towns",
          cells: [
            { v: "yes", text: "Sí" },
            { v: "yes", text: "Sí, con membresías de pago" },
            { v: "no", text: "No" },
            { v: "partial", text: "Depende de la comunidad" },
          ],
        },
        {
          name: "Kosmovia",
          highlight: true,
          cells: [
            { v: "yes", text: "Sí" },
            { v: "yes", text: "Sí, USDC en Stellar" },
            { v: "yes", text: "Sí, con KYC" },
            { v: "yes", text: "Sí" },
          ],
        },
      ],
    },
    {
      kind: "list",
      title: "De qué vive Kosmovia",
      items: [
        { lead: "Ahora:", text: "subvenciones del Stellar Community Fund." },
        {
          lead: "Después:",
          text: "una comisión chica sobre los pagos que pasan por la plataforma: envíos, links de cobro y garantías.",
        },
        {
          lead: "Herramientas premium",
          text: "para empresas verificadas: analíticas y acceso por API.",
        },
        {
          lead: "Lo que no haremos:",
          text: "token propio, canales de pago ni publicidad.",
        },
      ],
    },
    {
      kind: "roadmap",
      title: "Hoja de ruta — Primero Bolivia, después el mundo",
      nowLabel: contentEs.roadmap.nowLabel,
      stages: contentEs.roadmap.stages,
    },
    {
      kind: "team",
      title: "El equipo",
      people: [
        {
          name: "Alejandro",
          role: "Producto y backend: wallet, pagos y despliegues",
        },
        { name: "Roberto", role: "Backend y verificación de empresas (KYC)" },
        { name: "Victor", role: "Frontend, UX/UI y la presentación" },
        { name: "Carla", role: "Redes, marketing y marca" },
      ],
      footer: "Stellar Elite Bolivia · TechRebel",
    },
    {
      kind: "close",
      title: "Súmate",
      text: "Buscamos comunidades y testers en Bolivia, empresas piloto (concesionarias, inmobiliarias, fintechs) y tu opinión.",
      links: ["kosmovia.vercel.app", "github.com/kosmovia/kosmovia"],
      big: "Explora. Conecta. Pertenece.",
    },
  ],
};
