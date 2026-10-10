/**
 * Aprende Stellar: el contenido de las 5 lecciones, en el código. Español simple.
 * Cada lección tiene 3 a 5 párrafos cortos y 4 preguntas de opción múltiple (4
 * opciones, una correcta, con explicación breve). `correct` solo lo lee el
 * servidor: la API pública nunca lo manda (ver academia-rules.ts, `publicLesson`).
 *
 * Datos que se revisaron contra la documentación de Stellar (developers.stellar.org):
 * - El consenso es SCP (Stellar Consensus Protocol); un ledger se cierra cada ~5 segundos.
 * - La comisión base es 100 stroops = 0,00001 XLM por operación, sin importar el monto.
 * - La clave pública empieza con G y tiene 56 caracteres; la secreta empieza con S.
 * - Una cuenta necesita una reserva mínima en XLM (hoy 1 XLM; cada trustline suma 0,5 XLM).
 * - Un activo emitido se identifica por su código y su cuenta emisora.
 * - SEP-24: depósitos y retiros "interactivos" con un ancla.
 */

export interface LessonQuestion {
  text: string;
  /** Siempre 4 opciones. */
  options: [string, string, string, string];
  /** Índice (0..3) de la opción correcta. Solo el servidor lo lee. */
  correct: 0 | 1 | 2 | 3;
  /** Explicación breve, se muestra al corregir. */
  explanation: string;
}

export interface Lesson {
  id: string;
  title: string;
  /** Una frase para la lista. */
  summary: string;
  paragraphs: string[];
  questions: LessonQuestion[];
}

export const LESSONS: readonly Lesson[] = [
  {
    id: "que-es-stellar",
    title: "¿Qué es Stellar?",
    summary: "Una red abierta para mover dinero rápido y barato.",
    paragraphs: [
      "Stellar es una red abierta para mover dinero. Cualquiera puede usarla y ninguna empresa la controla por sí sola: la sostienen computadoras (nodos) repartidas por el mundo.",
      "Sirve sobre todo para pagos. Puedes enviar valor a otra persona, aunque esté en otro país, en pocos segundos y con una comisión muy baja, una fracción de centavo.",
      "Para ponerse de acuerdo, los nodos usan un sistema llamado SCP (Stellar Consensus Protocol). No hay minería ni un gasto enorme de energía: los nodos confirman entre ellos qué transacciones son válidas.",
      "Cada cierto tiempo la red anota las transacciones aprobadas en un ledger, que es como una página de un libro de cuentas. Se cierra un ledger nuevo más o menos cada 5 segundos.",
    ],
    questions: [
      {
        text: "¿Para qué se usa principalmente Stellar?",
        options: ["Para minar monedas con computadoras potentes", "Para mover dinero de forma rápida y barata", "Para guardar fotos y videos", "Para enviar correos electrónicos"],
        correct: 1,
        explanation: "Stellar está pensada para pagos: rápidos, de bajo costo y abiertos a cualquiera.",
      },
      {
        text: "¿Con qué sistema se ponen de acuerdo los nodos de Stellar?",
        options: ["Minería con Proof of Work", "Un banco central que aprueba cada pago", "SCP (Stellar Consensus Protocol)", "Una votación en redes sociales"],
        correct: 2,
        explanation: "Stellar usa SCP: los nodos confirman entre ellos las transacciones, sin minería.",
      },
      {
        text: "¿Cada cuánto se cierra un ledger, aproximadamente?",
        options: ["Cada 10 minutos", "Cada hora", "Cada día", "Cada 5 segundos"],
        correct: 3,
        explanation: "Un ledger nuevo se cierra cada unos 5 segundos, por eso los pagos se confirman tan rápido.",
      },
      {
        text: "¿Cuánto cuesta, más o menos, una transacción simple en Stellar?",
        options: ["Una fracción de centavo", "Unos 5 dólares", "El 1 % del monto enviado", "Nada, nunca se paga"],
        correct: 0,
        explanation: "La comisión base es de 0,00001 XLM por operación: una fracción de centavo.",
      },
    ],
  },
  {
    id: "cuentas-y-claves",
    title: "Cuentas y claves",
    summary: "Tu dirección pública, tu clave secreta y por qué importa quién las guarda.",
    paragraphs: [
      "Una cuenta de Stellar se identifica con una clave pública, también llamada dirección. Empieza con la letra G y tiene 56 caracteres. Puedes compartirla sin problema para que te envíen dinero.",
      "La cuenta tiene una pareja: la clave secreta, que empieza con la letra S. Con ella se firman los pagos. Quien la tenga controla tu dinero, así que nunca se comparte. Nadie legítimo te la va a pedir.",
      "Una cuenta nueva necesita un saldo mínimo en XLM, llamado reserva, para existir en la red. Esa reserva no se gasta: queda guardada en tu cuenta.",
      "En una wallet custodiada, un tercero (por ejemplo un exchange) guarda tus claves por ti. En una wallet propia, tú controlas la clave secreta y también eres responsable de cuidarla.",
    ],
    questions: [
      {
        text: "¿Con qué letra empieza una dirección pública de Stellar?",
        options: ["S", "G", "X", "A"],
        correct: 1,
        explanation: "Las direcciones públicas empiezan con G. Las claves secretas empiezan con S.",
      },
      {
        text: "¿Cuál de estas claves nunca se debe compartir?",
        options: ["La dirección pública (G…)", "El nombre de usuario", "La clave secreta (S…)", "El enlace de tu perfil"],
        correct: 2,
        explanation: "Quien tenga tu clave secreta puede firmar pagos y vaciar tu cuenta. Es solo tuya.",
      },
      {
        text: "¿Para qué sirve la reserva mínima en XLM?",
        options: ["Para que la cuenta pueda existir en la red", "Para pagar impuestos", "Para ganar intereses", "Para cambiar tu nombre de usuario"],
        correct: 0,
        explanation: "Cada cuenta debe mantener un saldo mínimo en XLM para existir. Esa reserva queda en tu cuenta.",
      },
      {
        text: "En una wallet custodiada, ¿quién guarda tus claves?",
        options: ["Solo tú, en un papel", "Nadie, no existen", "Un tercero, como un exchange", "Todos los nodos de la red"],
        correct: 2,
        explanation: "En una wallet custodiada otra empresa guarda las claves. En una wallet propia las controlas tú.",
      },
    ],
  },
  {
    id: "xlm-y-usdc",
    title: "XLM y USDC",
    summary: "El activo nativo de la red y una moneda digital que vale cerca de 1 dólar.",
    paragraphs: [
      "XLM (lumens) es el activo nativo de Stellar. Se usa para pagar las comisiones de la red y para mantener la reserva mínima de las cuentas.",
      "Todos los demás activos los emite alguien: una empresa o institución, llamada emisor. Un activo emitido se identifica por su código y por la cuenta del emisor. Dos activos con el mismo código pero distinto emisor son activos distintos.",
      "USDC es una stablecoin emitida por Circle. Una stablecoin busca mantener un valor estable: 1 USDC está pensado para valer cerca de 1 dólar estadounidense.",
      "Por eso se suele usar USDC para pagos y ahorros en dólares digitales, y XLM para cubrir comisiones y reservas. El valor de XLM, en cambio, sube y baja con el mercado.",
    ],
    questions: [
      {
        text: "¿Para qué sirve XLM en Stellar?",
        options: ["Solo para decorar la wallet", "Para pagar comisiones y mantener la reserva mínima", "Para comprar entradas a eventos", "Para guardar contraseñas"],
        correct: 1,
        explanation: "XLM paga las comisiones de red y cubre la reserva mínima de las cuentas.",
      },
      {
        text: "¿Quién emite el USDC?",
        options: ["Circle", "Stellar Development Foundation", "Cada usuario por su cuenta", "Un gobierno"],
        correct: 0,
        explanation: "USDC lo emite Circle. Stellar es la red por donde se mueve.",
      },
      {
        text: "¿Cuánto vale 1 USDC, aproximadamente?",
        options: ["Unos 100 dólares", "Lo mismo que 1 XLM", "Cambia mucho cada minuto", "Cerca de 1 dólar estadounidense"],
        correct: 3,
        explanation: "USDC es una stablecoin pensada para valer cerca de 1 USD.",
      },
      {
        text: "¿Cómo se identifica un activo emitido (que no es XLM) en Stellar?",
        options: ["Por su color", "Solo por su código, como USDC", "Por su código y la cuenta de su emisor", "Por la fecha en que lo creaste"],
        correct: 2,
        explanation: "Dos activos con el mismo código pero distinto emisor son distintos. Conviene revisar al emisor.",
      },
    ],
  },
  {
    id: "pagos-y-memos",
    title: "Pagos y memos",
    summary: "Qué pasa al enviar un pago, para qué sirve el memo y la diferencia entre testnet y mainnet.",
    paragraphs: [
      "Un pago en Stellar es una operación que firmas con tu clave secreta. Cuando entra en un ledger, ya es definitivo: es irreversible. No existe un botón para deshacerlo, así que revisa bien la dirección y el monto.",
      "La comisión es muy baja y no depende del monto: enviar poco o mucho cuesta casi lo mismo, una fracción de centavo por operación.",
      "El memo es una nota opcional que se adjunta al pago para identificarlo, por ejemplo un número de pedido. Algunos servicios comparten una sola dirección entre muchas personas y piden un memo para saber de quién es cada pago. Los memos son públicos: no pongas datos privados.",
      "Stellar tiene dos redes. Testnet es la red de pruebas: sus monedas no tienen valor real y sirve para practicar. Mainnet es la red real, con dinero real. Antes de pagar, confirma en cuál estás.",
    ],
    questions: [
      {
        text: "Cuando un pago ya se confirmó en un ledger, ¿se puede revertir?",
        options: ["Sí, durante 24 horas", "Sí, si lo pides al soporte de Stellar", "Sí, si el monto es pequeño", "No, los pagos son irreversibles"],
        correct: 3,
        explanation: "Un pago confirmado es definitivo. Por eso hay que revisar la dirección antes de enviar.",
      },
      {
        text: "¿Para qué sirve el memo de un pago?",
        options: ["Para identificar o etiquetar el pago", "Para pagar menos comisión", "Para que el pago llegue más rápido", "Para ocultar el monto"],
        correct: 0,
        explanation: "El memo es una referencia opcional. No cambia la comisión ni la velocidad, y es público.",
      },
      {
        text: "¿Qué es la testnet?",
        options: ["Una red con dinero real y más rápida", "Una red de pruebas con monedas sin valor real", "Una wallet para empresas", "Un tipo de memo"],
        correct: 1,
        explanation: "Testnet sirve para practicar sin arriesgar dinero. Mainnet es la red real.",
      },
      {
        text: "Si envías un monto mucho mayor, ¿qué pasa con la comisión?",
        options: ["Sube en proporción al monto", "La paga siempre quien recibe", "Se vuelve gratis", "No depende del monto: se cobra por operación"],
        correct: 3,
        explanation: "La comisión se cobra por operación, sin importar cuánto envíes.",
      },
    ],
  },
  {
    id: "trustlines-y-anclas",
    title: "Trustlines y anclas",
    summary: "Cómo tu cuenta acepta un activo y cómo entra y sale dinero local de la red.",
    paragraphs: [
      "Para tener un activo que no sea XLM, como USDC, tu cuenta debe crear una trustline. Es un aviso a la red: \"confío en este activo de este emisor\". Sin trustline no puedes recibir ese activo.",
      "Cada trustline sube un poco la reserva mínima de tu cuenta (0,5 XLM). Por eso conviene crear solo las que necesitas y confiar solo en emisores que conoces.",
      "Las anclas (anchors) son empresas que conectan Stellar con el mundo real. Reciben dinero local, por ejemplo desde un banco, y te dan el activo equivalente en Stellar. También hacen el camino inverso para retirar.",
      "SEP-24 es un estándar de Stellar que define cómo una app abre una ventana web del ancla para depositar o retirar de forma interactiva, y ahí completar los datos que el ancla pida.",
    ],
    questions: [
      {
        text: "¿Qué necesita tu cuenta para poder recibir USDC?",
        options: ["Una trustline hacia ese activo", "Un memo especial", "Cambiar de dirección pública", "Nada, recibe todo automáticamente"],
        correct: 0,
        explanation: "Sin trustline, la cuenta no puede tener ese activo. XLM es la excepción: no la necesita.",
      },
      {
        text: "¿Qué es un ancla en Stellar?",
        options: ["Un tipo de clave secreta", "Un nodo que cierra los ledgers", "Una empresa que conecta Stellar con dinero real, como los bancos", "Una comisión extra"],
        correct: 2,
        explanation: "Las anclas permiten depositar dinero local para recibir activos en Stellar y retirarlo después.",
      },
      {
        text: "¿Qué define el estándar SEP-24?",
        options: ["Cuánto cuesta cada comisión", "Cómo se escribe una dirección pública", "Cómo funciona el consenso SCP", "Cómo hacer depósitos y retiros interactivos con un ancla"],
        correct: 3,
        explanation: "SEP-24 describe el flujo interactivo de depósito y retiro entre una app y un ancla.",
      },
      {
        text: "¿Por qué conviene revisar al emisor antes de crear una trustline?",
        options: ["Porque cualquiera puede emitir un activo con el mismo código", "Porque la trustline cuesta 100 dólares", "Porque el emisor ve tu clave secreta", "No hace falta, todos son iguales"],
        correct: 0,
        explanation: "Un activo vale lo que respalda su emisor. Dos activos con el mismo código pueden ser muy distintos.",
      },
    ],
  },
];

export const LESSON_IDS: readonly string[] = LESSONS.map((l) => l.id);

export function getLesson(id: string): Lesson | null {
  return LESSONS.find((l) => l.id === id) ?? null;
}
