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

## Stack (a confirmar con Roberto)

- Contratos: Soroban (Rust)
- Cliente y scripts: TypeScript, Stellar SDK, Stellar RPC
- Wallet: Smart Account Kit (cuentas inteligentes con passkeys) + OpenZeppelin Relayer para pagar comisiones
- Chat: por decidir (la propuesta es Matrix con cliente propio)
- Website: se define en la etapa 0 y se publica gratis en Vercel
