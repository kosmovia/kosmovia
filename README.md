# Kosmovia

**Tu comunidad y tu dinero, en un solo lugar.**

Construimos hoy la infraestructura de comunidades en Stellar. Kosmovia reúne chat, una wallet en dólares digitales (USDC) y pagos entre personas en un mismo espacio. Está dirigida al público general, la comunidad cripto y los desarrolladores. Nace en Bolivia, con una visión global.

## Enlaces oficiales

- [Sitio web](https://kosmovia.vercel.app/)
- [Aplicación](https://kosmovia.onrender.com/)
- [Ingresar](https://kosmovia.onrender.com/login)
- [Pitch en español](https://kosmovia.vercel.app/es/pitch) · [Pitch en inglés](https://kosmovia.vercel.app/pitch)
- [Ayuda](https://kosmovia.onrender.com/ayuda) · [Privacidad](https://kosmovia.onrender.com/privacidad) · [Términos](https://kosmovia.onrender.com/terminos)

## Estado actual

Beta pública en **Stellar testnet**. Los fondos y pagos de prueba no representan dinero real. La landing se publica en Vercel; la aplicación y sus API corren juntas en un servicio de Render.

La principal está en español. La versión anterior en inglés se conserva en `/en`; `/es` redirige a la principal.

### Funciones implementadas en la beta

- Acceso con Google, correo o Freighter; wallet USDC integrada mediante Pollar.
- Perfiles con @usuario y avatares Kosmonauta.
- Comunidades, roles, categorías, canales públicos y privados, y mensajes directos.
- Chat con edición y eliminación de mensajes, imágenes y archivos adjuntos.
- Envíos y cobros por @usuario, PIN de pagos e historial con comprobantes verificables en Stellar.
- Mini-apps piloto: **Vaquita**, **Retos** y **Aprende Stellar**.
- Aplicación web instalable y soporte de notificaciones.

La disponibilidad de servicios como notificaciones y tiempo real depende de la configuración del entorno. Una función implementada en el repositorio no implica que haya sido auditada para mainnet.

## En qué nos diferenciamos

Kosmovia integra la conversación, la wallet y los comprobantes de pago dentro de la comunidad. Las personas pueden participar con Google o correo; los usuarios de Stellar también pueden conectarse con Freighter.

El enfoque incluye público general, comunidad cripto y desarrolladores, con una experiencia en español. Las mini-apps piloto permiten explorar ahorro grupal, juegos sin apuestas y educación sobre Stellar.

## Hoja de ruta

Construimos por etapas. Los objetivos pendientes no se presentan como funciones ya disponibles.

| Etapa | Alcance | Horizonte |
| --- | --- | --- |
| A · Comunidades + wallet | Base de comunidades, canales, chat y wallet USDC en testnet | Etapa actual |
| B · Explorar | Descubrir comunidades, perfiles y actividad | Objetivo: octubre de 2026 |
| C · Pagos | Ampliar envíos y cobros, pagos en comunidades, garantías y pagos divididos | Objetivo: octubre de 2026 |
| D · Empresas verificadas | Verificación de empresas (KYC) e integraciones | Objetivo: octubre de 2026 |
| E · Mini-apps | Ampliar la plataforma más allá de los pilotos actuales | 2027 |
| F · SDK abierto | Herramientas públicas para desarrolladores externos | 2027 |
| G · Más allá de Bolivia | Expansión a otros países y evaluación de rampas de entrada y mainnet | 2027 |

El paso a mainnet requiere una decisión del equipo, revisión de seguridad y revisión legal. Todo sigue en testnet hasta entonces.

## Tecnología

| Componente | Implementación |
| --- | --- |
| Landing y pitch | Next.js y React, publicados en Vercel |
| Aplicación y API | Next.js, frontend y backend en un solo servicio de Render |
| Acceso y wallet | Pollar; conexión con Freighter |
| Datos | PostgreSQL, con migraciones y soporte para Supabase |
| Red y pagos | Stellar testnet y USDC de prueba |
| Contratos | Integraciones Soroban; garantías y pagos divididos forman parte de la evolución de pagos |

El proyecto prioriza herramientas y planes gratuitos. Los proveedores pendientes, incluido KYC empresarial, se definen antes de su integración.

## Equipo y contacto

| Integrante | Responsabilidad |
| --- | --- |
| **Alejandro** | Producto, wallet, pagos y seguridad |
| **Roberto** | Backend, datos, tiempo real y contratos Soroban |
| **Victor** | Frontend, UX/UI y móvil |
| **Carla** | Marca, comunicación y comunidad |

Construido en el programa **Stellar Elite Bolivia · TechRebel**.

- [Telegram](https://t.me/kosmovia_official)
- [Instagram](https://instagram.com/kosmovia.io/)
- [TikTok](https://www.tiktok.com/@kosmovia0)
- [X](https://x.com/kosmoviaio)

## Estructura del repositorio

| Carpeta | Contenido |
| --- | --- |
| `web/` | Landing, pitch e imágenes públicas |
| `app/` | Aplicación, mini-apps, API y backend integrado en `app/lib/core/` |
| `app/db/` | Migraciones de PostgreSQL |
| `app/supabase/` | Migraciones y documentación del modo Supabase |
| `server/` | Espacio reservado para servicios separados; el backend actual está integrado en `app/` |
| `contracts/` | Espacio para contratos Soroban en Rust |
| `design/` | Recursos de marca y diseño |

## Desarrollo local

Requiere Node.js y npm. Ejecuta la landing y la aplicación en terminales separadas.

```bash
# Landing y pitch
cd web
npm install
npm run dev -- --port 3124
```

```bash
# Aplicación
cd app
npm install
npm run dev
```

La aplicación requiere las variables de entorno de los servicios utilizados. Consulta [la guía de la aplicación](app/README.md), [la base de datos](app/db/README.md) y [el despliegue en Render](app/DEPLOY-RENDER.md). No publiques archivos de entorno ni valores secretos.

Para validar la landing: `npm run build` desde `web/`. Para la aplicación: `npm test` y `npm run build` desde `app/`.

## Contribuir

Las tareas se coordinan en Notion; el código se trabaja en GitHub.

1. Una rama por tarea (`feat/...` o `fix/...`).
2. Commits pequeños con títulos claros.
3. Pull Request, revisión de otro integrante y merge a `main`.

Nunca subas claves privadas, frases semilla, tokens ni archivos `.env`. Kosmovia no custodia claves ni fondos de los usuarios. No hay airdrops por registrarse.

Reglas del proyecto: [AGENTS.md](AGENTS.md).
