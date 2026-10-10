# AGENTS.md · Reglas de Kosmovia

Valen para el equipo y para sus asistentes de IA (Claude, Antigravity).

## El proyecto

Kosmovia es una plataforma de comunidades con wallet y pagos integrados en Stellar, para personas, builders y empresas verificadas. Empezamos por Bolivia y después escalamos al mundo. Web primero, celular después. Sin canales de pago ni suscripciones.

## Reglas que no se rompen

- Nunca subir claves privadas, seed phrases, tokens ni archivos `.env`. Los secretos van en variables de entorno del hosting.
- Todo en **testnet** hasta que el equipo decida otra cosa.
- La app **no custodia** claves ni fondos de nadie.
- Solo herramientas gratuitas.
- Nada de airdrops por registrarse.

## Cómo trabajamos

- Una rama por tarea (`feat/...`, `fix/...`), Pull Request, revisión de otra persona y merge.
- Commits chicos y frecuentes; uno por cambio, con un título claro.
- Las tareas viven en Notion; el código, acá.
- Si algo no está claro, preguntar en el chat del equipo antes de inventar.

## Para la IA

- Responder en español, breve y directo.
- Antes de proponer una librería o servicio: que sea gratis y verificar que siga vigente.
- No crear archivos ni carpetas que nadie pidió; mantener el repo chico.
- No tocar configuración de despliegue ni secretos.
- Al terminar, resumir en una línea qué cambió.

## Por etapas

El proyecto se construye por etapas largas, no todo junto. Lo que no es de la etapa actual, no se empieza.

- **A · Comunidades + wallet (ahora)**
- **B · Explorar (oct 2026):** descubrir comunidades, perfiles y actividad en vivo, al estilo de Towns
- **C · Pagos (oct 2026):** infraestructura de wallet y pagos, no solo eventos: envíos y cobros por @usuario, pagos en comunidades y contratos (garantía o escrow, pagos divididos). Las entradas a eventos son solo un caso de uso
- **D · Empresas verificadas, KYC (oct 2026)**
- 2027: **E** mini apps · **F** SDK abierto · **G** más allá de Bolivia
- De la A a la D es el compromiso para octubre de 2026; de la E en adelante queda para 2027: no prometer más que eso, ni en los textos ni en el código

## Diseño

- Paleta turquesa, negro y blanco.
- Oscuro: fondo `#061314`, superficie `#0B1F21`, línea `#143235`, texto `#F2FBFA`, secundario `#8FB3B0`, turquesa `#2DD4BF`, turquesa fuerte `#14B8A6`, brillo `#5EEAD4`.
- Claro: fondo `#FFFFFF`, superficie `#F3F8F8`, línea `#DCE8E7`, texto `#0A1213`, secundario `#4B5F5E`, turquesa `#0F8F84`.
- La landing tiene modo claro y oscuro, y está en inglés (`/`) y español (`/es`).
- La dApp usa solo modo oscuro, con la misma paleta.
- No usar el logo de Stellar como logo propio.

## Stack

- Next.js en Vercel
- Pollar SDK para login, wallet USDC y comisiones patrocinadas
- Firebase como base de datos
- USDC en testnet de Stellar
- Proveedor de KYC para empresas, a definir (Roberto)
- Render solo si hace falta un backend aparte
- Contratos en Soroban (Rust) para pagos en garantía y pagos divididos. Desplegamos al menos un contrato propio en testnet: es un compromiso del proyecto, así que esa parte no se reemplaza por un servicio de terceros. Para lo que quede fuera de ese contrato, sigue valiendo evaluar servicios existentes en Stellar (por ejemplo Trustless Work) antes de escribir más código propio
