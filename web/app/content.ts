export type Content = {
  badge: string;
  tagline: string;
  lead: string;
  features: { title: string; text: string; stage?: string }[];
  roadmap: {
    title: string;
    intro: string;
    nowLabel: string;
    stages: {
      key: string;
      name: string;
      what: string;
      when: string;
      now?: boolean;
      soon?: boolean;
    }[];
  };
  cta: string;
  footer: string;
  ui: {
    switchLabel: string;
    switchText: string;
    switchHref: string;
    themeToLight: string;
    themeToDark: string;
  };
};

export const en: Content = {
  badge: "Building in public · Stellar Elite Bolivia",
  tagline: "Explore. Connect. Belong.",
  lead: "Communities with a wallet and payments built in, on Stellar. For people, builders and businesses — starting in Bolivia, built for the world.",
  features: [
    {
      title: "Communities",
      text: "Channels, roles and chat, with the layout you already know. Run by people, builders or companies.",
    },
    {
      title: "A wallet from day one",
      text: "Sign in with Google or email and your USDC wallet is ready. No seed phrases, no extensions, fees covered.",
    },
    {
      title: "Payments inside the community",
      stage: "B",
      text: "Sell event tickets with a QR at the door, run pools and send money by @username.",
    },
    {
      title: "Verified businesses",
      stage: "C",
      text: "Banks, fintechs, car dealers and real estate agencies get verified and open their own communities to reach users and builders.",
    },
  ],
  roadmap: {
    title: "How we get there",
    intro:
      "Bolivia first, then the world. Wallet, payments, verified businesses and the feed come first, in 2026; the rest follows in 2027.",
    nowLabel: "now",
    stages: [
      {
        key: "A",
        name: "A · Communities + wallet",
        what: "Sign in with Google or email, USDC wallet, communities, channels and chat",
        when: "Now",
        now: true,
      },
      {
        key: "B",
        name: "B · Payments",
        what: "Event tickets with QR, pools, send by @username",
        when: "Oct – Nov 2026",
        soon: true,
      },
      {
        key: "C",
        name: "C · Verified businesses",
        what: "Business verification (KYC), company communities, API connections",
        when: "Nov – Dec 2026",
        soon: true,
      },
      {
        key: "D",
        name: "D · Feed",
        what: "Posts, follows, Home and Explore",
        when: "Dec 2026",
        soon: true,
      },
      {
        key: "E",
        name: "E · Mini apps",
        what: "Apps running inside, opened from a post",
        when: "2027",
      },
      {
        key: "F",
        name: "F · Open to others",
        what: "A public SDK so anyone can publish an app",
        when: "2027",
      },
      {
        key: "G",
        name: "G · Beyond Bolivia",
        what: "More countries, mainnet and cash on-ramps",
        when: "2027",
      },
    ],
  },
  cta: "Follow the code on GitHub",
  footer: "Early development · testnet only · Built on Stellar",
  ui: {
    switchLabel: "Ver en español",
    switchText: "ES",
    switchHref: "/es",
    themeToLight: "Switch to light theme",
    themeToDark: "Switch to dark theme",
  },
};

export const es: Content = {
  badge: "Construyendo en público · Stellar Elite Bolivia",
  tagline: "Explora. Conecta. Pertenece.",
  lead: "Comunidades con wallet y pagos integrados, en Stellar. Para personas, builders y empresas: empezamos en Bolivia, pensado para el mundo.",
  features: [
    {
      title: "Comunidades",
      text: "Canales, roles y chat, con el diseño que ya conoces. Las pueden crear personas, builders o empresas.",
    },
    {
      title: "Una wallet desde el primer día",
      text: "Entra con Google o email y tu wallet en USDC ya está lista. Sin frases semilla, sin extensiones y sin pagar comisiones.",
    },
    {
      title: "Pagos dentro de la comunidad",
      stage: "B",
      text: "Vende entradas con QR para la puerta, organiza colectas y envía dinero por @usuario.",
    },
    {
      title: "Empresas verificadas",
      stage: "C",
      text: "Bancos, fintechs, concesionarias e inmobiliarias se verifican y abren sus propias comunidades para llegar a usuarios y builders.",
    },
  ],
  roadmap: {
    title: "Cómo llegamos",
    intro:
      "Primero Bolivia, después el mundo. La wallet, los pagos, las empresas verificadas y el muro van primero, en 2026; lo demás sigue en 2027.",
    nowLabel: "ahora",
    stages: [
      {
        key: "A",
        name: "A · Comunidades + wallet",
        what: "Entra con Google o email, wallet en USDC, comunidades, canales y chat",
        when: "Ahora",
        now: true,
      },
      {
        key: "B",
        name: "B · Pagos",
        what: "Entradas con QR, colectas, envíos por @usuario",
        when: "Oct – Nov 2026",
        soon: true,
      },
      {
        key: "C",
        name: "C · Empresas verificadas",
        what: "Verificación de empresas (KYC), comunidades de empresas, conexión por API",
        when: "Nov – Dic 2026",
        soon: true,
      },
      {
        key: "D",
        name: "D · Muro",
        what: "Publicaciones, seguidores, Inicio y Explorar",
        when: "Dic 2026",
        soon: true,
      },
      {
        key: "E",
        name: "E · Mini apps",
        what: "Apps que corren dentro, abiertas desde una publicación",
        when: "2027",
      },
      {
        key: "F",
        name: "F · Abierto a otros",
        what: "Un SDK público para que cualquiera publique su app",
        when: "2027",
      },
      {
        key: "G",
        name: "G · Más allá de Bolivia",
        what: "Más países, mainnet y rampas de efectivo",
        when: "2027",
      },
    ],
  },
  cta: "Sigue el código en GitHub",
  footer: "Desarrollo inicial · solo testnet · Construido en Stellar",
  ui: {
    switchLabel: "View in English",
    switchText: "EN",
    switchHref: "/",
    themeToLight: "Cambiar a tema claro",
    themeToDark: "Cambiar a tema oscuro",
  },
};
