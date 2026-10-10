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
      sub: "Communities with a wallet and payments built in, on Stellar. Free public BETA on TESTNET: try it with test funds.",
      meta: "Built in Bolivia · Stellar Elite Bolivia · TechRebel · kosmovia.vercel.app",
    },
    {
      id: "problem", kind: "list", title: "Charging your community is manual work",
      items: [
        { text: "Courses, mentoring and creator groups in Bolivia already charge members on Telegram and WhatsApp." },
        { text: "Bank QR payments, screenshots and manual access: every payment creates more work." },
        { text: "Organizers chase unpaid fees and match receipts to members." },
        { text: "Bolivia's US dollar shortage makes holding and charging in digital dollars attractive." },
      ],
    },
    {
      id: "solution", kind: "cards", title: "One place to connect and pay",
      items: [
        { head: "Your community", text: "Channels, roles and conversations in a familiar Discord or Towns style." },
        { head: "Your digital dollars", text: "A built-in USDC wallet, with payment history. Today, all funds are for testing on Stellar testnet." },
        { head: "Payments in the chat", text: "Pay any @username. Post invoices and keep receipts that can be checked on Stellar." },
        { head: "Mini-apps together", text: "Pool money, play and learn without leaving your community." },
      ],
    },
    {
      id: "how", kind: "steps", title: "How it works",
      items: [
        { lead: "Sign in.", text: "Google or email creates a custodial wallet managed by Pollar, without a seed phrase. Or connect your own Freighter wallet." },
        { lead: "Connect.", text: "Join a community or create your own, with channels and roles." },
        { lead: "Pay.", text: "Send test USDC by @username or pay an invoice. Enter your 6-digit payment PIN." },
      ],
    },
    {
      id: "works", kind: "list", title: "What already works",
      items: [
        { lead: "Chat:", text: "channels, categories, private channels, roles and DMs; edit or delete messages; attach files and images." },
        { lead: "Wallet:", text: "USDC history and payments to any @username, live on testnet." },
        { lead: "Receipts:", text: "invoices in #cobros and payment receipts in #verificacion-pagos." },
        { lead: "On your device:", text: "installable web app (PWA); push notifications for payments, DMs and mentions." },
        { lead: "Support:", text: "terms, privacy and help pages." },
      ],
    },
    {
      id: "miniapps", kind: "cards", title: "Mini-apps: pool, play and learn",
      items: [
        { head: "Vaquita · Live", text: "Pool money with friends for a shared goal. Contributions verified on Stellar." },
        { head: "Retos + Aprende Stellar · Live", text: "Tic-tac-toe and rock-paper-scissors: points, leaderboard, no money bets. Two-minute lessons, server-graded quizzes, missions and badges." },
        { head: "Isolated by design", text: "Each has its own identity and uses only our SDK (connection tools). You approve permissions with your PIN; apps never see it or your keys." },
        { head: "Coming soon", text: "Pasanaku (rotating savings), Split the bill, Tips, Memberships and Talent: freelancers and influencers with reputation connected to companies." },
      ],
    },
    {
      id: "security", kind: "cards", title: "Payment security, with clear limits",
      items: [
        { head: "A PIN for every payment", text: "Six digits, lockout and a daily limit. scrypt stores a protected fingerprint of the PIN, mixed with random data (salt) and a server secret (pepper)." },
        { head: "Approval for one payment", text: "One-use approval tied to destination, amount and payment note (memo). Payments made without the PIN are flagged." },
        { head: "Two adversarial reviews done", text: "Security reviews that tried to break the controls. An external audit is still required before mainnet, the network for real funds." },
        { head: "An app-level control today", text: "PIN checks and detection are not a cryptographic barrier. Enforcement at transaction signing, using Pollar passkey wallets or similar, is planned before mainnet." },
      ],
    },
    {
      id: "stellar", kind: "list", title: "Why Stellar",
      items: [
        { lead: "USDC:", text: "digital dollars for balances and payments; test funds during the beta." },
        { lead: "Low fees:", text: "very low network costs and fast settlement." },
        { lead: "Local money later:", text: "anchors, services using the SEP-24 standard to move between local money and USDC." },
        { lead: "Soroban:", text: "Stellar's smart contracts. Our Vaquita escrow contract is already deployed on testnet, with many pots in one contract." },
      ],
    },
    {
      id: "cases", kind: "cards", title: "Who it's for",
      items: [
        { head: "First: paid communities in Bolivia", text: "Courses, mentoring, academies, trading groups and creators already charging through Telegram or WhatsApp." },
        { head: "Then: friends and family", text: "Send money by @username and pool contributions for a common goal." },
        { head: "A bridge to existing groups", text: "Next: a Telegram bot to charge for access to groups people already use." },
        { head: "Companies come later", text: "Reach communities and connect with talent as the platform grows." },
      ],
    },
    {
      id: "money", kind: "list", title: "Business model",
      items: [
        { lead: "Free beta:", text: "commission code exists and is set to 0%." },
        { lead: "Later:", text: "a small commission only on money earned through Kosmovia, such as memberships and invoices." },
        { lead: "Friends:", text: "payments between friends always free. Founder communities keep a reduced rate on earnings." },
        { lead: "Premium tools:", text: "verified badge, creator analytics and bots." },
        { lead: "Companies:", text: "pay to reach communities." },
      ],
    },
    {
      id: "compare", kind: "table", title: "How we are different",
      caption: "Chat apps, crypto social apps (Towns, Farcaster), standalone wallets and Kosmovia compared",
      cols: ["Community", "Built-in dollars & payments", "Verifiable receipts", "Our focus"],
      rows: [
        { name: "Telegram / WhatsApp / Discord", cells: [
          { v: "yes", text: "Chat and groups" }, { v: "no", text: "Separate tools" },
          { v: "no", text: "Payment screenshots" }, { v: "partial", text: "General chat" },
        ] },
        { name: "Standalone wallets", cells: [
          { v: "no", text: "No community" }, { v: "yes", text: "Wallet and payments" },
          { v: "yes", text: "On-chain records" }, { v: "partial", text: "Money" },
        ] },
        { name: "Towns · US$35 M+ (a16z crypto, Coinbase Ventures)", cells: [
          { v: "yes", text: "Discord-style group chat" }, { v: "partial", text: "Crypto on Base: tips and memberships" },
          { v: "yes", text: "On-chain" }, { v: "partial", text: "Crypto-native users, English, global" },
        ] },
        { name: "Farcaster · US$180 M (a16z, Paradigm)", cells: [
          { v: "partial", text: "Public social feed and channels" }, { v: "partial", text: "Crypto wallet, needs Web3 know-how" },
          { v: "yes", text: "On-chain" }, { v: "partial", text: "Crypto natives; mini-apps (our inspiration)" },
        ] },
        { name: "Kosmovia", highlight: true, cells: [
          { v: "yes", text: "Channels, DMs and mini-apps" }, { v: "yes", text: "USDC on Stellar, sign in with Google" },
          { v: "yes", text: "Receipts in the chat" }, { v: "yes", text: "Everyday people in LatAm, in Spanish: vaquitas, Pasanaku next" },
        ] },
      ],
    },
    {
      id: "roadmap", kind: "roadmap", title: "Roadmap", nowLabel: "Done",
      stages: [
        { key: "done", name: "Public testnet beta", now: true, when: "Oct 2026", what: "Done · Oct 2026: communities, chat, wallet, payments, PIN, Vaquita, Retos, Aprende Stellar, attachments, notifications, installable app and legal pages." },
        { key: "access", name: "Community income", soon: true, when: "Next", what: "Telegram bridge bot for paid access to existing groups; paid memberships." },
        { key: "savings", name: "Savings and live chat", soon: true, when: "Next", what: "Pasanaku with the Soroban contract; live chat via Supabase Realtime, in review." },
        { key: "developers", name: "Developer platform", soon: true, when: "Later", what: "SDK (tools to connect mini-apps), API access keys and review before publishing." },
        { key: "mainnet", name: "Before real funds", when: "Mainnet", what: "External security audit, lawyer review of terms and PIN enforcement at transaction signing." },
      ],
    },
    {
      id: "team", kind: "team", title: "The team",
      people: [
        { name: "Alejandro", role: "Product, wallet, payments and security" },
        { name: "Roberto", role: "Backend, database, live chat and Soroban contracts" },
        { name: "Victor", role: "Frontend, UX/UI, landing and mobile" },
        { name: "Carla", role: "Brand, social media and community" },
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
      sub: "Comunidades con wallet y pagos integrados, en Stellar. BETA pública y gratuita en TESTNET: prueba con fondos de prueba.",
      meta: "Hecho en Bolivia · Stellar Elite Bolivia · TechRebel · kosmovia.vercel.app",
    },
    {
      id: "problem", kind: "list", title: "Cobrar a tu comunidad sigue siendo manual",
      items: [
        { text: "Cursos, mentorías y grupos de creadores en Bolivia ya cobran a sus miembros en Telegram y WhatsApp." },
        { text: "QR bancario, capturas de pago y acceso manual: cada cobro genera más trabajo." },
        { text: "Quien organiza persigue pagos pendientes y revisa a quién corresponde cada comprobante." },
        { text: "La escasez de dólares en Bolivia hace atractivo guardar y cobrar en dólares digitales." },
      ],
    },
    {
      id: "solution", kind: "cards", title: "Un solo lugar para conectar y pagar",
      items: [
        { head: "Tu comunidad", text: "Canales, roles y conversaciones con un estilo familiar, como Discord o Towns." },
        { head: "Tus dólares digitales", text: "Wallet integrada en USDC con historial de pagos. Hoy, todos los fondos son de prueba en testnet de Stellar." },
        { head: "Pagos en el chat", text: "Paga a cualquier @usuario. Publica cobros y guarda comprobantes verificables en Stellar." },
        { head: "Mini-apps en comunidad", text: "Reúne aportes, juega y aprende sin salir de tu comunidad." },
      ],
    },
    {
      id: "how", kind: "steps", title: "Cómo funciona",
      items: [
        { lead: "Entra.", text: "Con Google o correo, Pollar crea y custodia tu wallet, sin frase semilla. También puedes conectar tu propia wallet Freighter." },
        { lead: "Conecta.", text: "Únete a una comunidad o crea la tuya, con canales y roles." },
        { lead: "Paga.", text: "Envía USDC de prueba por @usuario o paga un cobro. Ingresa tu PIN de pago de 6 dígitos." },
      ],
    },
    {
      id: "works", kind: "list", title: "Lo que ya funciona",
      items: [
        { lead: "Chat:", text: "canales, categorías, canales privados, roles y mensajes directos; editar y borrar mensajes; adjuntar archivos e imágenes." },
        { lead: "Wallet:", text: "historial de USDC y pagos a cualquier @usuario, en testnet." },
        { lead: "Comprobantes:", text: "cobros publicados en #cobros y recibos en #verificacion-pagos." },
        { lead: "En tu dispositivo:", text: "app web instalable (PWA); notificaciones de pagos, mensajes directos y menciones." },
        { lead: "Ayuda:", text: "páginas de términos, privacidad y soporte." },
      ],
    },
    {
      id: "miniapps", kind: "cards", title: "Mini-apps: reúne, juega y aprende",
      items: [
        { head: "Vaquita · Disponible", text: "Reúne dinero con amigos para una meta común. Aportes verificados en Stellar." },
        { head: "Retos + Aprende Stellar · Disponibles", text: "Tres en raya y piedra, papel o tijera: puntos, clasificación, sin apuestas de dinero. Lecciones de 2 minutos, cuestionarios corregidos en servidor, misiones e insignias." },
        { head: "Aisladas por diseño", text: "Cada una tiene identidad propia y usa solo nuestro SDK (herramientas de conexión). Apruebas permisos con tu PIN; nunca ven el PIN ni tus claves." },
        { head: "Próximamente", text: "Pasanaku (ahorro por turnos), dividir la cuenta, propinas, membresías y Talent: freelancers e influencers con reputación conectados con empresas." },
      ],
    },
    {
      id: "security", kind: "cards", title: "Seguridad de pagos, con límites claros",
      items: [
        { head: "PIN antes de cada pago", text: "Seis dígitos, bloqueo por intentos y límite diario. scrypt guarda una huella protegida del PIN, mezclada con datos aleatorios (sal) y un secreto del servidor (pepper)." },
        { head: "Aprobación para un solo pago", text: "Vinculada al destino, monto y nota del pago (memo). Los pagos hechos sin PIN quedan marcados." },
        { head: "Dos revisiones adversariales hechas", text: "Revisiones que intentaron romper los controles. Falta una auditoría externa antes de mainnet, la red para fondos reales." },
        { head: "Hoy, un control de la app", text: "El PIN y la detección no son una barrera criptográfica. Falta exigirlo al firmar transacciones, con wallets Pollar passkey o similares, antes de mainnet." },
      ],
    },
    {
      id: "stellar", kind: "list", title: "Por qué Stellar",
      items: [
        { lead: "USDC:", text: "dólares digitales para saldos y pagos; fondos de prueba durante la beta." },
        { lead: "Comisiones bajas:", text: "costos de red muy bajos y pagos que se confirman rápido." },
        { lead: "Moneda local después:", text: "anchors, servicios que usan el estándar SEP-24 para pasar de moneda local a USDC y viceversa." },
        { lead: "Soroban:", text: "contratos inteligentes de Stellar. Nuestro contrato de garantía de Vaquita ya está desplegado en testnet: varias colectas en un contrato." },
      ],
    },
    {
      id: "cases", kind: "cards", title: "Para quién es",
      items: [
        { head: "Primero: comunidades que cobran en Bolivia", text: "Cursos, mentorías, academias, grupos de trading y creadores que ya cobran por Telegram o WhatsApp." },
        { head: "Después: amigos y familia", text: "Enviar dinero por @usuario y reunir aportes para una meta común." },
        { head: "Un puente a tus grupos actuales", text: "Lo siguiente: un bot de Telegram para cobrar acceso a los grupos que ya usas." },
        { head: "Las empresas vienen después", text: "Llegar a comunidades y conectar con talento a medida que crece la plataforma." },
      ],
    },
    {
      id: "money", kind: "list", title: "Modelo de negocio",
      items: [
        { lead: "Beta gratuita:", text: "el código de comisiones existe y está en 0 %." },
        { lead: "Después:", text: "una pequeña comisión solo sobre lo que ganas por Kosmovia, como membresías y cobros." },
        { lead: "Amigos:", text: "pagos entre amigos siempre gratis. Las comunidades fundadoras mantienen una tarifa reducida sobre sus ingresos." },
        { lead: "Herramientas premium:", text: "insignia verificada, estadísticas para creadores y bots." },
        { lead: "Empresas:", text: "pagan por llegar a las comunidades." },
      ],
    },
    {
      id: "compare", kind: "table", title: "En qué nos diferenciamos",
      caption: "Comparación entre apps de chat, redes sociales cripto (Towns, Farcaster), wallets independientes y Kosmovia",
      cols: ["Comunidad", "Dólares y pagos integrados", "Comprobantes verificables", "Enfoque"],
      rows: [
        { name: "Telegram / WhatsApp / Discord", cells: [
          { v: "yes", text: "Chat y grupos" }, { v: "no", text: "Herramientas separadas" },
          { v: "no", text: "Capturas de pago" }, { v: "partial", text: "Chat general" },
        ] },
        { name: "Wallets independientes", cells: [
          { v: "no", text: "Sin comunidad" }, { v: "yes", text: "Wallet y pagos" },
          { v: "yes", text: "Registros en la red" }, { v: "partial", text: "Dinero" },
        ] },
        { name: "Towns · US$35 M+ (a16z crypto, Coinbase Ventures)", cells: [
          { v: "yes", text: "Chat grupal estilo Discord" }, { v: "partial", text: "Cripto en Base: propinas y membresías" },
          { v: "yes", text: "En la red (on-chain)" }, { v: "partial", text: "Usuarios cripto, en inglés, global" },
        ] },
        { name: "Farcaster · US$180 M (a16z, Paradigm)", cells: [
          { v: "partial", text: "Red social pública con canales" }, { v: "partial", text: "Wallet cripto, pide saber de Web3" },
          { v: "yes", text: "En la red (on-chain)" }, { v: "partial", text: "Público cripto; sus mini-apps nos inspiran" },
        ] },
        { name: "Kosmovia", highlight: true, cells: [
          { v: "yes", text: "Canales, mensajes directos y mini-apps" }, { v: "yes", text: "USDC en Stellar, entras con Google" },
          { v: "yes", text: "Recibos en el chat" }, { v: "yes", text: "Gente común de Latinoamérica, en español: vaquitas, luego Pasanaku" },
        ] },
      ],
    },
    {
      id: "roadmap", kind: "roadmap", title: "Hoja de ruta", nowLabel: "Hecho",
      stages: [
        { key: "done", name: "Beta pública testnet", now: true, when: "Oct 2026", what: "Hecho · Oct 2026: comunidades, chat, wallet, pagos, PIN, Vaquita, Retos, Aprende Stellar, adjuntos, notificaciones, app instalable y páginas legales." },
        { key: "access", name: "Ingresos en comunidad", soon: true, when: "Siguiente", what: "Bot puente de Telegram para cobrar acceso a grupos existentes; membresías de pago." },
        { key: "savings", name: "Ahorro y chat en vivo", soon: true, when: "Siguiente", what: "Pasanaku con el contrato Soroban; chat en vivo con Supabase Realtime, en revisión." },
        { key: "developers", name: "Para desarrolladores", soon: true, when: "Después", what: "SDK (herramientas para conectar mini-apps), claves de acceso a la API y revisión antes de publicar." },
        { key: "mainnet", name: "Antes de fondos reales", when: "Mainnet", what: "Auditoría externa de seguridad, revisión legal de términos y PIN exigido al firmar transacciones." },
      ],
    },
    {
      id: "team", kind: "team", title: "El equipo",
      people: [
        { name: "Alejandro", role: "Producto, wallet, pagos y seguridad" },
        { name: "Roberto", role: "Backend, base de datos, chat en vivo y contratos Soroban" },
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
