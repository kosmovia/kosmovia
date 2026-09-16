# AGENTS.md · Reglas de Kosmovia

Valen para el equipo y para sus asistentes de IA (Claude, Antigravity).

## El proyecto

Kosmovia es una plataforma de comunidades gratuita para Stellar, estilo Discord, con wallet no custodia integrada. Web primero, celular después. Sin canales de pago ni suscripciones.

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

- **A · Base social (ahora):** identidad @usuario, comunidades, canales y chat
- Después: **B** muro · **C** wallet interna · **D** pagos · **E** mini apps nuestras · **F** SDK abierto a terceros · **G** escala

## Stack

- **Etapas A y B:** Next.js en Vercel, Supabase (Postgres, cuentas y tiempo real) y GitHub Actions
- **Etapa C en adelante (a confirmar con Roberto):** Stellar SDK y Stellar RPC en TypeScript, passkeys, Smart Account Kit de OpenZeppelin, OpenZeppelin Relayer y SEP-10; Soroban en Rust solo donde haga falta un contrato
- **Mini apps:** iframe aislado con puente de mensajes y un SDK propio en TypeScript
- Matrix se evalúa recién en la etapa F, si queremos federación y puentes con Telegram y Discord
