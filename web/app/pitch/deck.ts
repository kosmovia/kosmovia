export type Item = { lead?: string; text: string; link?: string };
export type Card = { head: string; text: string };
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
  const found = deck.slides.find((s) => s.id === id);
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
};

export const en: Deck = {
  lang: "en",
  ui: {
    back: "Back to the Kosmovia site",
    backText: "Kosmovia",
    backHref: "/en",
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
      sub: "Free public Stellar testnet beta: communities, wallet and test payments.",
      meta: "Bolivia · Stellar Elite Bolivia · TechRebel",
    },
    {
      id: "problem", kind: "list", title: "Community payments are manual",
      items: [
        { lead: "Paid groups", text: "Bolivian courses, mentors and creators charge through Telegram and WhatsApp." },
        { lead: "Manual access", text: "Bank QR payments and screenshots create extra work." },
        { lead: "Unpaid fees", text: "Organizers chase payments and match receipts to members." },
        { lead: "Digital dollars", text: "Bolivia’s dollar shortage makes saving and charging digitally attractive." },
      ],
    },
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
      id: "works", kind: "list", title: "Ready today",
      items: [
        { lead: "Chat", text: "Private channels, categories, roles, DMs, message editing/deletion and attachments." },
        { lead: "Wallet", text: "Testnet USDC history, @username payments, #cobros invoices, #verificacion-pagos receipts." },
        { lead: "Your device", text: "Installable app; payment, DM and mention notifications." },
        { lead: "Support", text: "Terms, privacy and help pages." },
      ],
    },
    {
      id: "miniapps", kind: "cards", title: "Pool, play, learn",
      items: [
        { head: "Live apps", text: "Vaquita: Stellar-verified pools; Retos: tic-tac-toe/rock-paper-scissors, points/leaderboards, no money bets." },
        { head: "Aprende Stellar", text: "Live: two-minute lessons, graded quizzes, missions and badges." },
        { head: "Your permissions", text: "Separate identities, SDK-only access; PIN approval, keys/PIN stay private." },
        { head: "Coming soon", text: "Pasanaku savings, bill splits, tips, memberships; Talent connects freelancers/influencers with reputation to companies." },
      ],
    },
    {
      id: "security", kind: "cards", title: "Security and limits",
      items: [
        { head: "Payment PIN", text: "Six digits, protected storage, lockout and daily limit." },
        { head: "Single approval", text: "Recipient, amount and note linked; payments without PIN flagged." },
        { head: "Two reviews", text: "Controls challenged twice; external audit required before real funds." },
        { head: "Current limits", text: "App checks only; PIN enforcement at signing planned before mainnet." },
      ],
    },
    {
      id: "stellar", kind: "list", title: "Why Stellar",
      items: [
        { lead: "USDC", text: "Digital dollars for balances/payments; test funds during beta." },
        { lead: "Low fees", text: "Low network costs and fast payments." },
        { lead: "Local money later", text: "Services to exchange local money and USDC." },
        { lead: "Soroban", text: "Stellar contracts; Vaquita escrow on testnet, multiple pools per contract." },
      ],
    },
    {
      id: "cases", kind: "cards", title: "Who it serves",
      items: [
        { head: "Bolivian communities", text: "Courses, mentoring, academies, trading groups, creators charging via Telegram/WhatsApp." },
        { head: "Friends and family", text: "Later: @username payments and contributions toward shared goals." },
        { head: "Existing groups", text: "Next: Telegram bot for paid group access." },
        { head: "Companies later", text: "Reach communities and connect with talent." },
      ],
    },
    {
      id: "money", kind: "list", title: "Business model",
      items: [
        { lead: "Beta: 0%", text: "Commission code exists; later, small fees on earnings through memberships/invoices." },
        { lead: "Friends pay free", text: "Always; founder communities keep reduced fees on earnings." },
        { lead: "Premium tools", text: "Verified badge, creator analytics and bots." },
        { lead: "Companies", text: "Pay to reach communities." },
      ],
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
          { v: "yes", text: "Receipts in the chat" }, { v: "yes", text: "Everyday people, in Spanish" },
        ] },
      ],
    },
    {
      id: "roadmap", kind: "roadmap", title: "Roadmap", nowLabel: "Done",
      stages: [
        { key: "done", name: "Testnet beta", now: true, when: "Oct 2026", what: "Communities, wallet, PIN payments and 3 mini-apps" },
        { key: "access", name: "Community income", soon: true, when: "Next", what: "Telegram bot and paid memberships" },
        { key: "savings", name: "Savings and developers", soon: true, when: "Later", what: "Pasanaku on Soroban, live chat and SDK" },
        { key: "mainnet", name: "Real money", when: "Mainnet", what: "Audit, legal review and PIN at signing" },
      ],
    },
    {
      id: "team", kind: "team", title: "The team",
      people: [
        { name: "Alejandro", role: "Product, wallet, payments, security" },
        { name: "Roberto", role: "Backend, data, chat, Soroban contracts" },
        { name: "Victor", role: "Frontend, UX/UI, landing, mobile" },
        { name: "Carla", role: "Brand, social media, community" },
      ],
      footer: "Stellar Elite Bolivia · TechRebel",
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
    backHref: "/",
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
      sub: "Beta pública gratuita: comunidades, wallet y pagos de prueba en Stellar testnet.",
      meta: "Bolivia · Stellar Elite Bolivia · TechRebel",
    },
    {
      id: "problem", kind: "list", title: "Cobrar sigue siendo manual",
      items: [
        { lead: "Grupos de pago", text: "Cursos, mentores y creadores bolivianos cobran por Telegram y WhatsApp." },
        { lead: "Acceso manual", text: "QR bancario y capturas generan más trabajo." },
        { lead: "Pagos pendientes", text: "Organizadores persiguen pagos y asignan comprobantes a miembros." },
        { lead: "Dólares digitales", text: "La escasez de dólares vuelve atractivo ahorrar y cobrar digitalmente." },
      ],
    },
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
        { lead: "Entra", text: "Google/correo: Pollar custodia tu wallet sin frase semilla; o Freighter." },
        { lead: "Conecta", text: "Únete o crea tu comunidad con canales y roles." },
        { lead: "Paga", text: "USDC de prueba por @usuario/cobro; PIN de seis dígitos." },
      ],
    },
    {
      id: "works", kind: "list", title: "Ya disponible",
      items: [
        { lead: "Chat", text: "Canales privados, categorías, roles, mensajes directos, edición/borrado y adjuntos." },
        { lead: "Wallet", text: "Historial USDC/testnet, pagos @usuario, cobros #cobros y recibos #verificacion-pagos." },
        { lead: "Tu dispositivo", text: "App instalable; notificaciones de pagos, mensajes directos y menciones." },
        { lead: "Ayuda", text: "Términos, privacidad y soporte." },
      ],
    },
    {
      id: "miniapps", kind: "cards", title: "Reúne, juega, aprende",
      items: [
        { head: "Apps disponibles", text: "Vaquita: aportes verificados en Stellar; Retos: tres-en-raya/piedra-papel-tijera, puntos/clasificación, sin apuestas." },
        { head: "Aprende Stellar", text: "Disponible: lecciones de dos minutos, cuestionarios corregidos, misiones e insignias." },
        { head: "Tus permisos", text: "Identidades separadas, acceso por SDK; apruebas con PIN, claves/PIN privados." },
        { head: "Próximamente", text: "Pasanaku, dividir cuentas, propinas, membresías; Talent conecta freelancers/influencers con reputación y empresas." },
      ],
    },
    {
      id: "security", kind: "cards", title: "Seguridad y límites",
      items: [
        { head: "PIN de pago", text: "Seis dígitos, almacenamiento protegido, bloqueo por intentos y límite diario." },
        { head: "Aprobación única", text: "Destino, monto y nota vinculados; pagos sin PIN marcados." },
        { head: "Dos revisiones", text: "Controles puestos a prueba; falta auditoría externa antes de mainnet." },
        { head: "Límites actuales", text: "Control de app; exigir PIN al firmar antes de mainnet." },
      ],
    },
    {
      id: "stellar", kind: "list", title: "Por qué Stellar",
      items: [
        { lead: "USDC", text: "Dólares digitales para saldos/pagos; fondos de prueba durante la beta." },
        { lead: "Comisiones bajas", text: "Bajos costos de red y pagos rápidos." },
        { lead: "Moneda local después", text: "Servicios para intercambiar moneda local y USDC." },
        { lead: "Soroban", text: "Contratos Stellar; garantía Vaquita en testnet, varias colectas por contrato." },
      ],
    },
    {
      id: "cases", kind: "cards", title: "Para quién",
      items: [
        { head: "Comunidades bolivianas", text: "Cursos, mentorías, academias, grupos de trading, creadores cobrando por Telegram/WhatsApp." },
        { head: "Amigos y familia", text: "Después: pagos por @usuario y aportes para metas comunes." },
        { head: "Grupos actuales", text: "Próximo: bot de Telegram para cobrar acceso." },
        { head: "Empresas después", text: "Llegar a comunidades y conectar con talento." },
      ],
    },
    {
      id: "money", kind: "list", title: "Modelo de negocio",
      items: [
        { lead: "Beta gratuita", text: "Comisiones implementadas al 0%; después, cargos sobre ingresos por membresías/cobros." },
        { lead: "Amigos gratis", text: "Siempre; comunidades fundadoras mantienen comisiones reducidas sobre ingresos." },
        { lead: "Herramientas premium", text: "Insignia verificada, estadísticas para creadores y bots." },
        { lead: "Empresas", text: "Pagan por llegar a comunidades." },
      ],
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
          { v: "yes", text: "Recibos en el chat" }, { v: "yes", text: "Gente común, en español" },
        ] },
      ],
    },
    {
      id: "roadmap", kind: "roadmap", title: "Hoja de ruta", nowLabel: "Hecho",
      stages: [
        { key: "done", name: "Beta en testnet", now: true, when: "Oct 2026", what: "Comunidades, wallet, pagos con PIN y 3 mini-apps" },
        { key: "access", name: "Cobrar en comunidad", soon: true, when: "Próximo", what: "Bot de Telegram y membresías de pago" },
        { key: "savings", name: "Ahorro y desarrolladores", soon: true, when: "Después", what: "Pasanaku en Soroban, chat en vivo y SDK" },
        { key: "mainnet", name: "Dinero real", when: "Mainnet", what: "Auditoría, revisión legal y PIN al firmar" },
      ],
    },
    {
      id: "team", kind: "team", title: "El equipo",
      people: [
        { name: "Alejandro", role: "Producto, wallet, pagos y seguridad" },
        { name: "Roberto", role: "Backend, datos, chat, contratos Soroban" },
        { name: "Victor", role: "Frontend, UX/UI, landing y móvil" },
        { name: "Carla", role: "Marca, redes sociales y comunidad" },
      ],
      footer: "Stellar Elite Bolivia · TechRebel",
    },
    {
      id: "close", kind: "close", title: "Súmate",
      text: "Trae a tu comunidad, prueba la beta gratuita en testnet y comparte tu opinión.",
      links: ["kosmovia.onrender.com", "kosmovia.vercel.app", "github.com/kosmovia/kosmovia", "t.me/kosmovia_official", "instagram.com/kosmovia.io", "tiktok.com/@kosmovia0", "x.com/kosmoviaio"],
      big: "Explora. Conecta. Pertenece.",
    },
  ],
};
