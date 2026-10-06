# Guía de deploy en Render: demo testnet de Kosmovia

Para Roberto. Se publica **un solo Web Service** desde el repo `github.com/kosmovia/kosmovia`, carpeta `app`: la misma app sirve las pantallas y el backend (rutas `/api`). La base es Postgres (Supabase). Todo es **testnet**; no se usa dinero real.

## Regla de secretos (leer primero)
- **Nunca** subas un `.env` ni `.env.local` al repo. Las claves se escriben solo en el panel de Render (Environment).
- Las claves se pasan **por mensaje privado**, nunca por el grupo ni por el repo.
- Esta guía solo nombra variables; los valores te los da Alejandro en privado.

## 1. Base de datos en Supabase
1. Crea el proyecto en Supabase (plan gratis).
2. **Connect > Connection string**: copia la del **Session pooler** (puerto 5432). Esa es la `DATABASE_URL`.
3. Corre las migraciones una vez, desde tu PC en `app/`, con la URL solo en la sesión de la terminal (nunca en un archivo versionado):
   ```bash
   DATABASE_URL="postgresql://..." npm run db:migrate
   ```
   Aplica en orden los archivos de `app/db/migrations/` (0001 a 0006). Comprobación: `npm run db:check`.
4. **Que no se pause:** Supabase gratis se pausa tras 7 días sin uso. Basta una tarea programada que visite `https://<app>/api/communities` cada 2 o 3 días (por ejemplo un GitHub Action con `schedule`), porque esa ruta consulta la base.

## 2. El servicio en Render
**New > Web Service** > repo `kosmovia/kosmovia`, rama `main`.

| Campo | Valor |
| --- | --- |
| Name | `kosmovia` |
| Root Directory | `app` |
| Runtime | Node |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm run start` |
| Health Check Path | `/api/communities` |
| Node | 22 (variable `NODE_VERSION=22`) |

- `npm run start` ejecuta `next start`, que **lee `PORT` automáticamente** (Render lo define).
- `/api/communities` (GET) es pública; si falta `DATABASE_URL` o `KOSMOVIA_DATA_BACKEND=api`, responde 503/404 y el health check avisa.

**Variables de entorno** (solo nombres; las marcadas son secretas):

| Variable | Secreta | Valor |
| --- | --- | --- |
| `NEXT_PUBLIC_KOSMOVIA_SERVICES` | no | `api` |
| `KOSMOVIA_DATA_BACKEND` | no | `api` |
| `NEXT_PUBLIC_KOSMOVIA_DATA_BACKEND` | no | `api` |
| `DATABASE_URL` | **sí** | la de Supabase (paso 1) |
| `SESSION_SECRET` | **sí** | 32+ caracteres al azar |
| `NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY` | no (pública) | clave publicable de Pollar, testnet |
| `POLLAR_SECRET_KEY` | **sí** | **Opcional.** Solo con fondeo *Deferred*; con *Immediate* (el que usamos) va vacía |
| `X_CHALLENGE_SECRET` | **sí** | 16+ caracteres al azar |
| `DATABASE_SSL` | no | `no-verify` si la base es el pooler de Supabase (usa su propia CA) |
| `NEXT_PUBLIC_SUPABASE_URL` | no (pública) | la del proyecto de Supabase, para el chat en vivo |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | no (pública) | la clave anon/publishable, para el chat en vivo |
| `SUPABASE_JWT_PRIVATE_KEY` | **sí** | PEM ES256 importado en Supabase (Settings > JWT), para el chat en vivo |
| `SUPABASE_JWT_KEY_ID` | no | el `kid` de esa clave |

- Las `NEXT_PUBLIC_*` se fijan **al compilar**. Si cambias alguna: **Manual Deploy > Clear build cache & deploy**.
- **Chat en vivo (Supabase Realtime).** Las cuatro variables `SUPABASE_*` de la tabla son las del tiempo real, y hacen falta **también en modo `api`**: el navegador abre el WebSocket de Supabase con un JWT corto que emite `/api/realtime/token`, firmado con esa clave. Sin ellas el chat sigue funcionando, pero por polling cada 2,5 s y sin el indicador de "escribiendo". La clave importada en Supabase tiene que quedar como **Current** (Settings > JWT > Rotate keys), y las políticas RLS de `supabase/migrations/0001` son las que deciden qué mensajes recibe cada quien.
- Al terminar, apunta la URL pública (`https://kosmovia-xxxx.onrender.com`): es la que se abre en la demo.

## 3. Pollar: autorizar el dominio
En **dashboard.pollar.xyz > Build > Domains**, agrega la URL pública en:
- **Allowed origins**
- **Allowed redirect URIs** (necesario para el login con Google)

En **Treasury** (sin esto, las wallets de Google/email fallan con `SDK_WALLET_NOT_READY`):
- **Funding Mode = Immediate**.
- La **funding wallet** y la **gas wallet** con XLM de testnet (50+ y 10+), cargadas con friendbot.stellar.org.
- **Tokens & Trustlines**: USDC de testnet habilitado.

`http://localhost:3000` se queda para desarrollo local.

## 4. Plan gratis
Los Web Services gratis de Render se duermen tras 15 minutos sin tráfico y la primera visita tarda (a veces un minuto). Antes de la demo, abre la app unos minutos antes, o usa una instancia de pago con los créditos (recomendado para la demo).

## 5. Verificación final
- [ ] `https://<app>/api/communities` devuelve JSON con `communities` y `mine`.
- [ ] `https://<app>/login` carga y el login con Google funciona.
- [ ] `/plataforma` muestra las comunidades.
- [ ] **Mi Wallet** muestra el saldo.
- [ ] Enviar 0,01 USDC a otro miembro (`@usuario`) sale bien.
- [ ] El historial muestra el pago.

## 6. Si algo falla
| Síntoma | Causa probable y arreglo |
| --- | --- |
| Pagos con wallets de Google/email fallan: `SDK_WALLET_NOT_READY` | Funding Mode no está en Immediate o la funding/gas wallet no tiene XLM (paso 3). |
| "Could not load sign-in options" | El dominio no está autorizado en Pollar (paso 3), o falta `NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY` y se necesita redeploy. |
| `403 bad_origin` ("Origen no permitido") | Se entra por una URL distinta a la del servicio. |
| `503 db_not_configured` | Falta `DATABASE_URL` o es incorrecta. |
| `503 session_not_configured` | Falta `SESSION_SECRET` (32+ caracteres). |
| `404 backend_disabled` ("No encontrado") | Falta `KOSMOVIA_DATA_BACKEND=api`. |
| La app queda en modo demo | Faltó `NEXT_PUBLIC_KOSMOVIA_SERVICES=api` al compilar: redeploy con limpieza de caché. |
| Errores de tablas inexistentes (500) | No se corrieron las migraciones (paso 1). |
| El chat anda pero tarda ~2,5 s y no hay "escribiendo…" | Falta alguna variable `SUPABASE_*`, o la clave importada no quedó como **Current** en Supabase: el navegador no consigue token y queda en polling. |
| TLS: `SELF_SIGNED_CERT_IN_CHAIN` al conectar a la base | El pooler de Supabase usa su propia CA: falta `DATABASE_SSL=no-verify`. |
| `401 session_required` / `session_invalid` | Sesión vencida o `SESSION_SECRET` cambió: vuelve a entrar. |
| Primera carga muy lenta | El servicio estaba dormido (paso 4). |

Para ver el detalle de un error, usa **Logs** del servicio en Render. Los logs muestran códigos, no valores.
