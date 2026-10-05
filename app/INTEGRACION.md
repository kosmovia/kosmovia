# Kosmovia en local

Una sola app (`app/`): las pantallas de Victor y el backend (rutas `/api` en `app/api`, lógica en `lib/core`, migraciones en `db/`) corren en el mismo servidor, en el puerto **3000**, que es el origen autorizado en Pollar.

## Cómo correrlo
```bash
cd app
cp .env.example .env.local   # completa las claves (pídelas por privado)
npm install
npm run dev
```
Abre http://localhost:3000/login, entra y ve a `/plataforma`.

Sin `NEXT_PUBLIC_KOSMOVIA_SERVICES=api`, la app queda en modo demo con localStorage.

## Comandos
| Comando | Qué hace |
| --- | --- |
| `npm run dev` | App y backend en http://localhost:3000 |
| `npm test` | Tests del backend (no tocan la base ni Pollar) |
| `npm run db:migrate` | Aplica `db/migrations/` a la base de `DATABASE_URL` |
| `npm run db:check` | Comprueba la base |

## Qué está conectado (modo `api`)
| Servicio | Qué usa |
| --- | --- |
| `authService` | Login con **Pollar** (Google, email, Freighter) y sesión firmada (cookie httpOnly). Perfil real (`/api/profile`) |
| `communityService` | Comunidades, canales, miembros, roles y foto (`/api/communities…`) |
| `chatService` | Mensajes con polling cada 2,5 s (`/api/channels/:id/messages`) |
| `walletService` | Saldo en Horizon testnet, historial (`/api/payments`) y **pagos con Pollar** a un `@usuario`, con protección contra pagos dobles |
| `settlementService` | Sigue en demo: no hay liquidaciones B2B reales |

## Limitaciones
- **Cobros B2B:** las liquidaciones (fee 0,5 %, lotes) siguen en demo.
- **Presencia:** solo tú sales "en línea" (todavía no hay presencia en tiempo real).
- **Mensajes directos y Explorar:** próximamente.

La guía para publicarla está en `DEPLOY-RENDER.md`.
