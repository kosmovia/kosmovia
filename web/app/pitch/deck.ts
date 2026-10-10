export type Item = { lead?: string; text: string; link?: string };
export type Card = { head: string; text: string; details?: string[] };
export type Screenshot = { src: string; alt: string; caption?: string; width: number; height: number };
export type Mark = { v: "yes" | "no" | "partial"; text: string };
export type RoadmapStage = {
  key: string;
  name: string;
  what: string;
  when: string;
  now?: boolean;
  soon?: boolean;
};

export type SlideId =
  | "cover" | "problem" | "solution" | "how" | "works"
  | "miniapps" | "security" | "stellar" | "cases" | "money"
  | "compare" | "roadmap" | "team" | "close";

export type Slide = { id: SlideId } & (
  | { kind: "cover"; title: string; tagline: string; sub: string; meta: string }
  | { kind: "list"; title: string; items: Item[] }
  | { kind: "cards"; title: string; items: Card[] }
  | { kind: "showcase"; title: string; layout: "product" | "phones"; items: Item[]; images: Screenshot[]; caption?: string; note?: string }
  | { kind: "team-contact"; title: string; people: { name: string; role: string }[]; text: string }
  | { kind: "steps"; title: string; items: Item[] }
  | {
      kind: "table";
      title: string;
      caption: string;
      cols: string[];
      rows: { name: string; highlight?: boolean; cells: Mark[] }[];
    }
  | { kind: "roadmap"; title: string; nowLabel: string; stages: RoadmapStage[] }
  | { kind: "team"; title: string; people: { name: string; role: string }[]; footer: string }
  | { kind: "close"; title: string; text: string; links: string[]; big: string }
);

export type SlideOf<K extends Slide["kind"]> = Extract<Slide, { kind: K }>;

/** Retrieve a typed slide for consumers that share the deck's copy. */
export function section<K extends Slide["kind"]>(
  deck: Deck,
  id: SlideId,
  kind: K,
): SlideOf<K> {
  const found = deck.slides.find((s) => s.id === id && s.kind === kind)
    ?? deck.sections?.find((s) => s.id === id && s.kind === kind);
  if (!found || found.kind !== kind) {
    throw new Error(`Deck slide "${id}" (${kind}) not found`);
  }
  return found as SlideOf<K>;
}

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
    slideOf: string;
    deckLabel: string;
  };
  slides: Slide[];
  /** Legacy landing copy, outside the eight-slide presentation. */
  sections?: Slide[];
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
      id: "cover", kind: "cover", title: "Kosmovia",
      tagline: "Your community and your money, in one place.",
      sub: "Communities with a wallet and USDC payments on Stellar. Public testnet beta.",
      meta: "Stellar Elite Bolivia · TechRebel"
    },
    {
      id: "problem", kind: "list", title: "Problem and opportunity",
      items: [
        { text: "Communities coordinate in chats; collections require QR codes, screenshots and follow-ups." },
        { text: "Money and conversation use separate tools, without verifiable receipts." },
        { text: "Bolivia’s limited dollar access creates demand for digital dollars (USDC)." }
      ]
    },
    {
      id: "solution", kind: "showcase", title: "The product",
      layout: "product",
      items: [
        { text: "Communities with channels, roles and direct messages" },
        { text: "USDC wallet: Google or email access, no seed phrase" },
        { text: "PIN payments with verifiable receipts on Stellar" }
      ],
      note: "Six-digit PIN, attempt lockout and daily limits. App-level controls during testnet beta.",
      images: [
        { src: "/pitch/app-chat.webp", alt: "Kosmovia: community, chat and wallet", width: 1600, height: 1000 },
        { src: "/pitch/app-pin.webp", alt: "Payment confirmation with PIN", width: 360, height: 780 }
      ]
    },
    {
      id: "miniapps", kind: "showcase", title: "Mini-apps",
      layout: "phones",
      items: [],
      images: [
        { src: "/pitch/app-vaquita.webp", alt: "Vaquita: contributions toward a shared goal", caption: "Vaquita: contributions toward a shared goal", width: 360, height: 780 },
        { src: "/pitch/app-retos.webp", alt: "Retos: games between members, without betting", caption: "Retos: games between members, without betting", width: 360, height: 780 },
        { src: "/pitch/app-aprende.webp", alt: "Aprende Stellar: lessons, missions and badges", caption: "Aprende Stellar: lessons, missions and badges", width: 360, height: 780 }
      ],
      caption: "Each mini-app runs in isolation, with permissions and PIN approval. Coming soon: a software development kit (SDK) for third parties."
    },
    {
      id: "compare", kind: "table", title: "How we are different",
      caption: "Chat, crypto social, wallets and Kosmovia",
      cols: ["Community", "Built-in dollars & payments", "Verifiable receipts", "Our focus"],
      rows: [
        { name: "Telegram, WhatsApp, Discord", cells: [
          { v: "yes", text: "Chat and groups" }, { v: "no", text: "Separate tools" },
          { v: "no", text: "Payment screenshots" }, { v: "partial", text: "General chat" },
        ] },
        { name: "Standalone wallets", cells: [
          { v: "no", text: "No community" }, { v: "yes", text: "Wallet and payments" },
          { v: "yes", text: "On-chain records" }, { v: "partial", text: "Money" },
        ] },
        { name: "Towns · US$35M+ (a16z)", cells: [
          { v: "yes", text: "Discord-style group chat" }, { v: "partial", text: "Crypto on Base" },
          { v: "yes", text: "On-chain" }, { v: "partial", text: "Crypto users, English" },
        ] },
        { name: "Farcaster · US$180M (Paradigm)", cells: [
          { v: "partial", text: "Public social feed" }, { v: "partial", text: "Crypto wallet (Web3)" },
          { v: "yes", text: "On-chain" }, { v: "partial", text: "Crypto users, mini-apps" },
        ] },
        { name: "Kosmovia", highlight: true, cells: [
          { v: "yes", text: "Channels and mini-apps" }, { v: "yes", text: "USDC, Google sign-in" },
          { v: "yes", text: "Receipts in the chat" }, { v: "yes", text: "General audiences, crypto communities and developers" },
        ] },
      ],
    },
    {
      id: "money", kind: "cards", title: "Business model and why Stellar",
      items: [
        {
          head: "Model",
          text: "Free beta.",
          details: [
            "Fees only on platform earnings: memberships and collections.",
            "Free payments between people.",
            "Premium tools and organization accounts."
          ]
        },
        {
          head: "Why Stellar",
          text: "Native USDC: digital dollars.",
          details: [
            "Minimal fees and settlement in seconds.",
            "Anchors: services connecting digital balances with local money.",
            "Soroban contracts: Vaquita escrow already deployed on testnet."
          ]
        }
      ]
    },
    {
      id: "roadmap", kind: "roadmap", title: "Roadmap",
      nowLabel: "Done",
      stages: [
        {
          key: "done",
          name: "Testnet beta",
          now: true,
          when: "Oct 2026",
          what: "Communities, wallet, PIN payments and mini-apps"
        },
        {
          key: "income",
          name: "Community monetization",
          soon: true,
          when: "Next",
          what: "Real-time chat and paid memberships"
        },
        {
          key: "savings",
          name: "Savings and developers",
          when: "Later",
          what: "Pasanaku on Soroban and a mini-app SDK"
        },
        {
          key: "mainnet",
          name: "Mainnet",
          when: "",
          what: "Security audit, legal review and scalability"
        }
      ]
    },
    {
      id: "team", kind: "team-contact", title: "Team and contact",
      people: [
        { name: "Alejandro", role: "Product, wallet, payments and security" },
        { name: "Roberto", role: "Backend, data, real-time systems and Soroban contracts" },
        { name: "Victor", role: "Frontend, UX/UI and mobile" },
        { name: "Carla", role: "Brand, communications and community" }
      ],
      text: "Public beta on Stellar testnet."
    },
  ],
  sections: [
    {
      id: "solution", kind: "cards", title: "Connect and pay",
      items: [
        { head: "Your community", text: "Channels, roles and conversations like Discord or Towns." },
        { head: "Digital dollars", text: "USDC wallet and history; Stellar test funds today." },
        { head: "Chat payments", text: "Pay @usernames, post invoices and verify receipts on Stellar." },
        { head: "Mini-apps", text: "Pool money, play and learn within your community." },
      ],
    },
    {
      id: "how", kind: "steps", title: "How it works",
      items: [
        { lead: "Sign in", text: "Google/email: Pollar-managed wallet, no seed phrase; or connect Freighter." },
        { lead: "Connect", text: "Join or create a community with channels and roles." },
        { lead: "Pay", text: "Send test USDC by @username/invoice; enter your six-digit PIN." },
      ],
    },
    {
      id: "close", kind: "close", title: "Join us",
      text: "Bring your community, try the free testnet beta and share your feedback.",
      links: ["kosmovia.onrender.com", "kosmovia.vercel.app", "github.com/kosmovia/kosmovia", "t.me/kosmovia_official", "instagram.com/kosmovia.io", "tiktok.com/@kosmovia0", "x.com/kosmoviaio"],
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
      id: "cover", kind: "cover", title: "Kosmovia",
      tagline: "Tu comunidad y tu dinero, en un solo lugar.",
      sub: "Comunidades con wallet y pagos en USDC sobre Stellar. Beta pública en testnet.",
      meta: "Stellar Elite Bolivia · TechRebel"
    },
    {
      id: "problem", kind: "list", title: "Problema y oportunidad",
      items: [
        { text: "Comunidades y proyectos coordinan por chat; cobran con QR, capturas y seguimiento." },
        { text: "Dinero y conversación usan herramientas separadas, sin comprobantes verificables." },
        { text: "Bolivia necesita dólares digitales (USDC) ante el acceso limitado a dólares." }
      ]
    },
    {
      id: "solution", kind: "showcase", title: "El producto",
      layout: "product",
      items: [
        { text: "Comunidades con canales, roles y mensajes directos" },
        { text: "Wallet USDC: acceso con Google o email, sin frase semilla" },
        { text: "Pagos con PIN y comprobantes verificables en Stellar" }
      ],
      note: "PIN de seis dígitos, bloqueo por intentos y límites diarios. Controles de la app durante la beta en testnet.",
      images: [
        { src: "/pitch/app-chat.webp", alt: "Kosmovia: comunidad, chat y wallet", width: 1600, height: 1000 },
        { src: "/pitch/app-pin.webp", alt: "Confirmación de pago con PIN", width: 360, height: 780 }
      ]
    },
    {
      id: "miniapps", kind: "showcase", title: "Mini-apps",
      layout: "phones",
      items: [],
      images: [
        { src: "/pitch/app-vaquita.webp", alt: "Vaquita: aportes para un objetivo común", caption: "Vaquita: aportes para un objetivo común", width: 360, height: 780 },
        { src: "/pitch/app-retos.webp", alt: "Retos: juegos entre miembros, sin apuestas", caption: "Retos: juegos entre miembros, sin apuestas", width: 360, height: 780 },
        { src: "/pitch/app-aprende.webp", alt: "Aprende Stellar: lecciones, misiones e insignias", caption: "Aprende Stellar: lecciones, misiones e insignias", width: 360, height: 780 }
      ],
      caption: "Cada mini-app corre aislada y se conecta con permisos y PIN. Próximamente: SDK para terceros (kit de desarrollo)."
    },
    {
      id: "compare", kind: "table", title: "En qué nos diferenciamos",
      caption: "Chat, redes cripto, wallets y Kosmovia",
      cols: ["Comunidad", "Dólares y pagos integrados", "Comprobantes verificables", "Enfoque"],
      rows: [
        { name: "Telegram, WhatsApp, Discord", cells: [
          { v: "yes", text: "Chat y grupos" }, { v: "no", text: "Herramientas separadas" },
          { v: "no", text: "Capturas de pago" }, { v: "partial", text: "Chat general" },
        ] },
        { name: "Wallets independientes", cells: [
          { v: "no", text: "Sin comunidad" }, { v: "yes", text: "Wallet y pagos" },
          { v: "yes", text: "Registros en la red" }, { v: "partial", text: "Dinero" },
        ] },
        { name: "Towns · US$35M+ (a16z)", cells: [
          { v: "yes", text: "Chat grupal estilo Discord" }, { v: "partial", text: "Cripto en Base" },
          { v: "yes", text: "En la red (on-chain)" }, { v: "partial", text: "Público cripto, en inglés" },
        ] },
        { name: "Farcaster · US$180M (Paradigm)", cells: [
          { v: "partial", text: "Red social pública" }, { v: "partial", text: "Wallet cripto (Web3)" },
          { v: "yes", text: "En la red (on-chain)" }, { v: "partial", text: "Público cripto, mini-apps" },
        ] },
        { name: "Kosmovia", highlight: true, cells: [
          { v: "yes", text: "Canales y mini-apps" }, { v: "yes", text: "USDC, entras con Google" },
          { v: "yes", text: "Recibos en el chat" }, { v: "yes", text: "Público general, comunidad cripto y desarrolladores" },
        ] },
      ],
    },
    {
      id: "money", kind: "cards", title: "Modelo de negocio y por qué Stellar",
      items: [
        {
          head: "Modelo",
          text: "Beta gratuita.",
          details: [
            "Comisión solo sobre ingresos generados en la plataforma: membresías y cobros.",
            "Pagos entre personas sin costo.",
            "Herramientas premium y cuentas para organizaciones."
          ]
        },
        {
          head: "Por qué Stellar",
          text: "USDC nativo: dólares digitales.",
          details: [
            "Comisiones mínimas y liquidación en segundos.",
            "Anclas: servicios para conectar con dinero local.",
            "Contratos Soroban: garantía de Vaquita ya desplegada en testnet."
          ]
        }
      ]
    },
    {
      id: "roadmap", kind: "roadmap", title: "Hoja de ruta",
      nowLabel: "Hecho",
      stages: [
        {
          key: "done",
          name: "Beta en testnet",
          now: true,
          when: "Oct 2026",
          what: "Comunidades, wallet, pagos con PIN y mini-apps"
        },
        {
          key: "income",
          name: "Monetización de comunidades",
          soon: true,
          when: "Próximo",
          what: "Chat en tiempo real y membresías de pago"
        },
        {
          key: "savings",
          name: "Ahorro y desarrolladores",
          when: "Después",
          what: "Pasanaku en Soroban y SDK para mini-apps"
        },
        {
          key: "mainnet",
          name: "Mainnet",
          when: "",
          what: "Auditoría de seguridad, revisión legal y escalabilidad"
        }
      ]
    },
    {
      id: "team", kind: "team-contact", title: "Equipo y contacto",
      people: [
        { name: "Alejandro", role: "Producto, wallet, pagos y seguridad" },
        { name: "Roberto", role: "Backend, datos, tiempo real y contratos Soroban" },
        { name: "Victor", role: "Frontend, UX/UI y móvil" },
        { name: "Carla", role: "Marca, comunicación y comunidad" }
      ],
      text: "Beta pública en testnet de Stellar."
    },
  ],
  sections: [
    {
      id: "solution", kind: "cards", title: "Conecta y paga",
      items: [
        { head: "Tu comunidad", text: "Canales, roles y conversaciones como Discord o Towns." },
        { head: "Dólares digitales", text: "Wallet USDC e historial; hoy, fondos de prueba en Stellar." },
        { head: "Pagos en chat", text: "Paga @usuarios, publica cobros y verifica recibos en Stellar." },
        { head: "Mini-apps", text: "Reúne aportes, juega y aprende en tu comunidad." },
      ],
    },
    {
      id: "how", kind: "steps", title: "Cómo funciona",
      items: [
        { lead: "Entra", text: "Google/correo: wallet sin frase semilla; o Freighter." },
        { lead: "Conecta", text: "Únete o crea tu comunidad con canales y roles." },
        { lead: "Paga", text: "USDC de prueba por @usuario/cobro; PIN de seis dígitos." },
      ],
    },
    {
      id: "close", kind: "close", title: "Súmate",
      text: "Trae a tu comunidad, prueba la beta gratuita en testnet y comparte tu opinión.",
      links: ["kosmovia.onrender.com", "kosmovia.vercel.app", "github.com/kosmovia/kosmovia", "t.me/kosmovia_official", "instagram.com/kosmovia.io", "tiktok.com/@kosmovia0", "x.com/kosmoviaio"],
      big: "Explora. Conecta. Pertenece.",
    },
  ],
};

