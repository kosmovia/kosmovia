export type Content = {
  badge: string;
  nav: {
    label: string;
    skip: string;
    solution: string;
    how: string;
    cases: string;
    roadmap: string;
    team: string;
  };
  actions: { how: string; github: string };
  roadmap: {
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
  nav: {
    label: "Main",
    skip: "Skip to content",
    solution: "Solution",
    how: "How it works",
    cases: "Use cases",
    roadmap: "Roadmap",
    team: "Team",
  },
  actions: { how: "See how it works", github: "Follow the code on GitHub" },
  roadmap: {
    intro:
      "Bolivia first, then the world. Communities, the wallet, Explore, payments and verified businesses all arrive in October 2026; the rest follows in 2027.",
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
        name: "B · Explore",
        what: "Discover communities, profiles and what's happening now",
        when: "Oct 2026",
        soon: true,
      },
      {
        key: "C",
        name: "C · Payments",
        what: "Send and request money by @username, community payments, escrow and split contracts",
        when: "Oct 2026",
        soon: true,
      },
      {
        key: "D",
        name: "D · Verified businesses",
        what: "Business verification (KYC), company communities, API connections",
        when: "Oct 2026",
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
  nav: {
    label: "Principal",
    skip: "Saltar al contenido",
    solution: "Solución",
    how: "Cómo funciona",
    cases: "Casos de uso",
    roadmap: "Hoja de ruta",
    team: "Equipo",
  },
  actions: { how: "Ver cómo funciona", github: "Sigue el código en GitHub" },
  roadmap: {
    intro:
      "Primero Bolivia, después el mundo. Las comunidades, la wallet, Explorar, los pagos y las empresas verificadas llegan en octubre de 2026; lo demás sigue en 2027.",
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
        name: "B · Explorar",
        what: "Descubre comunidades, perfiles y lo que está pasando ahora",
        when: "Oct 2026",
        soon: true,
      },
      {
        key: "C",
        name: "C · Pagos",
        what: "Envíos y cobros por @usuario, pagos en comunidades, contratos de garantía y pagos divididos",
        when: "Oct 2026",
        soon: true,
      },
      {
        key: "D",
        name: "D · Empresas verificadas",
        what: "Verificación de empresas (KYC), comunidades de empresas, conexión por API",
        when: "Oct 2026",
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
  footer: "Desarrollo inicial · solo testnet · Construido en Stellar",
  ui: {
    switchLabel: "View in English",
    switchText: "EN",
    switchHref: "/",
    themeToLight: "Cambiar a tema claro",
    themeToDark: "Cambiar a tema oscuro",
  },
};
