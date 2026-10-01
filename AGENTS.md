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
- **B · Pagos**
- **C · Empresas verificadas (KYC)**
- Luego: **D** muro · **E** mini apps · **F** SDK abierto · **G** más allá de Bolivia
- A, B y C son el compromiso; de la D en adelante no hay fecha: no prometer nada de eso, ni en los textos ni en el código

## Stack

- Next.js en Vercel
- Pollar SDK para login, wallet USDC y comisiones patrocinadas
- Firebase como base de datos
- USDC en testnet de Stellar
- Proveedor de KYC para empresas, a definir (Roberto)
- Render solo si hace falta un backend aparte
- Soroban en Rust solo donde haga falta un contrato
