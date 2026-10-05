# Kosmovia core · Etapa A

Backend y pantallas mínimas de la etapa A: cuentas con wallet, perfil con avatar, comunidades y chat. Vive en `core/`, separado de `app/` (Victor), `server/` (Roberto) y `web/` (landing). Se integra con los demás cuando el equipo esté de acuerdo.

Todo corre en **testnet**.

## Piezas

| Pieza | Herramienta | Estado |
| --- | --- | --- |
| App y rutas API | Next.js 16 en Vercel, proyecto propio (`kosmovia-core`) | Decidido |
| Login y wallet | Pollar SDK 0.11 (`@pollar/core`, `@pollar/react`) | Decidido |
| Base de datos y chat en tiempo real | Supabase Free (Postgres + Realtime + RLS) | Recomendado, a confirmar con Roberto |
| Avatar | Generador propio en SVG, sin IA de pago | Decidido |
| Cuenta de X | Verificación con una publicación (gratis, oEmbed de X) | Decidido |
| NFT del avatar | SEP-50 con los contratos de OpenZeppelin | Después de la etapa A |

## 1. Login con wallet

- **Pollar** ofrece cuatro formas de entrar:
  - Google, GitHub o email, con una wallet `internal` (cuenta G cuya clave guarda Pollar).
  - Passkey, con una wallet `smart` (cuenta C).
  - **Freighter** o Albedo, con una wallet `external` (la clave es del usuario). Vienen integrados: `pollar.login({ provider: WalletType.FREIGHTER })`.
- **Patrocinio:** Pollar arma la creación de la cuenta y la trustline de USDC firmadas por la wallet de fondeo de la app, también para usuarios de Freighter. Cuesta 1 XLM de reserva más 0,5 XLM por trustline, y en testnet esa wallet se carga gratis con Friendbot.
- **Límites:** en testnet son 1.000 requests por día. Los topes `max_fee_per_tx` y `daily_ops_cap` se configuran en el dashboard.
- **Falta confirmar:** si Pollar también paga las comisiones (fee-bump) de los pagos hechos con Freighter, y si el endpoint de fondeo es `/v1/wallets/fund` o `/v1/wallets/activate`.

## 2. Cómo sabe el servidor quién es el usuario

Las sesiones de Pollar están atadas al dispositivo (DPoP), así que reenviar su token al servidor no prueba nada. Usamos el patrón que ya funciona en Pollar Pass:

1. El navegador firma un mensaje corto con la wallet: `client.stellar.sep53.signMessage("kosmovia-auth:v1:{dirección}:{vence}")`, válido por 2 minutos.
2. `POST /api/auth/session` verifica la firma ed25519 contra la dirección. Es criptografía pura, sin llamar a Pollar.
3. Si la firma es válida, el servidor emite un **JWT de Supabase** firmado con nuestra clave (ES256), con:
   - `sub`: el id del usuario;
   - `role: authenticated`;
   - `wallet`: la dirección;
   - vencimiento de 1 hora.
4. Las políticas RLS de Supabase leen ese JWT con `auth.jwt()`. Cada usuario solo puede escribir lo suyo.

La clave privada de firma vive solo en las variables de entorno de Vercel y del `.env` local. Nunca va al repo.

## 3. Datos (Supabase)

Los nombres y campos siguen los tipos que Victor ya usa en `app/types/index.ts`, para que la integración sea directa.

| Tabla | Campos principales |
| --- | --- |
| `profiles` | `id`, `wallet` (única), `username` (única, `@...`), `display_name`, `avatar_seed`, `avatar_style`, `bio`, `trust_level` (0 wallet · 1 social · 2 empresa), `x_handle`, `x_verified_at`, `created_at` |
| `communities` | `id`, `slug` (único), `name`, `icon`, `description`, `owner_id`, `created_at` |
| `members` | `community_id`, `profile_id`, `role` (`owner` · `admin` · `member`), `joined_at` |
| `channels` | `id`, `community_id`, `name`, `topic`, `type` (`text` · `announcement`) |
| `messages` | `id`, `channel_id`, `author_id`, `content`, `created_at` |

**Reglas (RLS):**
- **Perfiles:** cualquiera puede leer los perfiles públicos, y cada uno edita solo el suyo.
- **Comunidades:** solo los miembros leen los canales y mensajes de su comunidad, y solo escriben en canales `text`. En los canales `announcement` solo escriben `owner` y `admin`.
- **Administración:** solo `owner` y `admin` crean canales y cambian roles.

El **chat en tiempo real** usa Supabase Realtime sobre `messages`, filtrado por canal.

**Plan gratis:** 500 MB de base, 200 conexiones de tiempo real al mismo tiempo y 2 millones de mensajes por mes. Alcanza de sobra para la etapa A. El proyecto se pausa tras una semana sin uso, así que un cron gratis de GitHub Actions lo mantiene despierto.

## 4. Avatar al crear la cuenta

- **Kosmonautas:** pixel art de 24×24 armado por capas, solo con colores de la paleta (`lib/avatar/kosmonautas.ts`).
  - **Rasgos:** fondo, traje, casco, ojos, boca, visor y accesorio, con 5 a 7 opciones cada uno.
  - **Rareza:** por ahora todos son Común; Raro y Épico vendrán después.
- **Al registrarse:**
  - el usuario elige cada rasgo con flechas, o usa **"Aleatorio"**;
  - el **candado** deja fijo un rasgo para que Aleatorio no lo cambie;
  - hay **6 sugerencias** desde la dirección de la wallet y un botón "Otras".
- **Se guarda solo el código de rasgos** en `avatar_seed` (por ejemplo `k1.3.0.1.4.2.0.5`), con `avatar_style = 'kosmonauta'`. El SVG se vuelve a dibujar igual en cualquier lado.
  - Opciones nuevas van siempre al final de su lista: el código usa la posición.
  - Cada combinación es de una sola persona (índice único `profiles_kosmonauta_key`).
  - Los 7 estilos del primer generador siguen funcionando para perfiles viejos.
- **Los rasgos ya salen en el formato de OpenSea** (`attributes: [{trait_type, value}]`), listos para el NFT.
- **Después de la etapa A:** acuñar el avatar como NFT en testnet con SEP-50 (contratos `non_fungible` de OpenZeppelin), a cargo de Roberto.

## 5. Conectar X (nivel de confianza 1)

La API de X dejó de ser gratis en febrero de 2026: leer un perfil cuesta USD 0,01. Proponemos dos caminos:

1. **Gratis (recomendado para empezar):**
   - el usuario publica en X un código que le damos (por ejemplo `kosmovia:7F3K`) y pega el link de la publicación;
   - el servidor lo comprueba con el oEmbed público de X, que no pide clave, y guarda `x_handle` y `x_verified_at`.
   - El endpoint es `publish.x.com/oembed?url=...`. Probado el 01/10/2026: responde sin clave y devuelve el autor (`author_url`) y el texto de la publicación.
2. **Pago, opcional:** OAuth de X más una sola lectura de `/2/users/me` por usuario. Cuesta unos USD 10 cada 1.000 usuarios, y alcanza con el crédito inicial de X. Trae `verified_type`.

**Qué significa cada check de X:**
- El azul (`blue`) solo indica que la persona paga X Premium.
- El dorado (`business`) indica una organización verificada, y es útil para las empresas de la etapa D.

## 6. Pantallas mínimas (solo modo oscuro)

1. **Entrar:** Google, email o Freighter.
2. **Crear perfil:** @usuario, nombre y elección de avatar.
3. **Wallet:** dirección, saldo XLM/USDC y link al explorador.
4. **Comunidades:** lista, crear y unirse.
5. **Chat:** canales, mensajes y miembros.
6. **Perfil:** avatar, nivel de confianza y conectar X.

## 7. Variables de entorno (nombres, nunca valores)

`NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY` · `POLLAR_SECRET_KEY` · `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_JWT_PRIVATE_KEY` · `SUPABASE_JWT_KEY_ID` · `X_CHALLENGE_SECRET`

- `X_CHALLENGE_SECRET` (solo servidor, mínimo 16 caracteres): clave del HMAC que deriva el código que el usuario publica en X. Sin ella, `/api/x/challenge` y `/api/x/verify` responden 503.
- `POLLAR_SECRET_KEY` (solo servidor, solo `sec_testnet_...`): solo hace falta con el modo de fondeo DEFERRED.
- `SUPABASE_JWT_PRIVATE_KEY` y `SUPABASE_JWT_KEY_ID` firman dos tokens: la sesión del usuario (1 hora) y el del verificador de X (2 minutos, rol `kosmovia_verifier`).
- Nunca se usa la `service_role` de Supabase.

## 8. Seguridad

Resumen de lo que protege cada pieza (detalle en `supabase/README.md` y `docs/POLLAR-NOTES.md`):

- **Identidad.** Cada ruta de la API exige una prueba SEP-53 firmada, atada a método y ruta, de 2 minutos. Antes de verificar la firma ed25519 se rechazan las claves degeneradas (punto identidad, puntos de orden pequeño, codificaciones no canónicas) y las firmas con S no canónica (`lib/ed25519-guards.ts`): sin esto, una "dirección" que sea el punto identidad aceptaba una firma constante para cualquier mensaje.
- **Abuso de la API.** Límites en memoria (`lib/rate-limit.ts`): fondeo 3 por hora por wallet y 10 por IP, con wallets ya fondeadas recordadas y llamadas simultáneas deduplicadas; verificación de X 10 por hora por wallet; código de X 20 por hora por wallet. Son best-effort en serverless; el limitador persistente (tabla de Supabase o Vercel KV) es el siguiente paso.
- **Escrituras directas a Supabase.** Cuotas atómicas en la base (`0002_hardening.sql`): 3 comunidades por 24 h y 10 en total por perfil, 20 mensajes por minuto y 500 por hora por autor, 50 canales por comunidad.
- **Avatares.** CHECK de `avatar_seed` (hasta 64 caracteres seguros) y de `avatar_style` (lista del generador). El cliente recorta la semilla a 64 caracteres, ignora un estilo desconocido y nunca interpola semilla ni estilo en el SVG (se inyecta con `dangerouslySetInnerHTML`).
- **Chat.** Solo se guardan en memoria los últimos 200 mensajes por canal (el historial se pide de a 50 con "Cargar anteriores", con un tope de 1.000), y de cada autor solo se traen `id, username, display_name, avatar_seed, avatar_style`, una vez por autor.
- **Verificación de X.** El servidor escribe `x_handle`, `x_verified_at` y `trust_level = 1` con el rol `kosmovia_verifier` (JWT de 2 minutos, permisos por columna, nunca nivel 2), sin `service_role`. Un índice único hace que una cuenta de X pertenezca a un solo perfil.
- **Secretos.** Las claves privadas viven solo en variables de entorno del servidor; los logs no imprimen direcciones, firmas, tokens ni claves.

## 8 bis. Modo "api" (Postgres plano, para pruebas)

Además de Supabase hay un segundo camino de datos, pensado para probar la etapa A en una base Postgres común (la de pruebas de Roberto en Render). Se elige con `KOSMOVIA_DATA_BACKEND=api` (servidor) y `NEXT_PUBLIC_KOSMOVIA_DATA_BACKEND=api` (navegador); sin ellas todo sigue como en Supabase.

- **Sesión:** la misma prueba SEP-53, pero `POST /api/auth/session` pone una cookie `httpOnly` `kosmovia_session` (JWT HS256 con `SESSION_SECRET`, 12 horas) en vez de devolver un token. `lib/session-cookie.ts`.
- **Datos:** el navegador llama a rutas REST (`/api/profile`, `/api/communities`, `/api/communities/[slug]/...`, `/api/channels/[id]/messages`); el servidor usa `pg` con consultas parametrizadas (`lib/db/`). Sin RLS, la autorización (miembro, owner/admin, autor = sesión) se hace en el servidor con `lib/authz.ts`; las cuotas siguen siendo triggers de la base.
- **Chat:** sin Realtime, consulta cada 2,5 s con la pestaña visible.
- **Esquema:** `db/migrations/0001_stage_a.sql` (`npm run db:migrate`).
- Cómo aplicarlo, probarlo y volver a Supabase: `db/README.md`.

Variables nuevas: `KOSMOVIA_DATA_BACKEND` · `NEXT_PUBLIC_KOSMOVIA_DATA_BACKEND` · `DATABASE_URL` · `SESSION_SECRET` (y `DATABASE_SSL`, opcional).

## 8 ter. Pagos entre usuarios (etapa C, solo modo "api")

- **Enviar** (`/wallet` y `/pagar/<usuario>`): eliges a un @usuario (o pegas una dirección G…), el monto en USDC o XLM y una nota opcional.
  - Antes de confirmar se revisa en Horizon que esa wallet exista y pueda recibir el activo, y ves su Kosmonauta.
  - Pollar firma y envía con `sendPayment`: el servidor de Kosmovia nunca tiene claves.
  - **Nunca dos veces** (traído de Pollar Pass, probado con pagos reales):
    - cada envío lleva un memo único (`kv-…`) y vive 5 minutos (`timeoutSec`);
    - el navegador lo recuerda antes de llamar al SDK;
    - un error sin hash es "desconocido", no "no se envió": la app lo busca por memo (`POST /api/payments { memo, startedAt }`);
    - solo deja enviar de nuevo cuando la red ya pasó el plazo y el pago no está.
- **Registrar** (`POST /api/payments { hash, note }`):
  - El servidor lee la transacción en Horizon testnet y la guarda solo si es un pago exitoso de XLM o USDC, enviado por la wallet de la sesión en las últimas 24 horas.
  - Cada operación se guarda una sola vez (`op_id` único), así no cuenta doble ni con el hash interno ni con el externo de un fee bump.
  - Si Horizon todavía no la ve, responde 202 y el cliente reintenta.
- **Historial** (`GET /api/payments`): los pagos que la wallet envió o recibió, con el perfil de cada lado. La nota solo la ven quien envía y quien recibe; no va a la red.
- **Recibir**: un link `/pagar/<usuario>?monto=5&activo=USDC` y su QR.
- **Regalo de bienvenida** (también de Pollar Pass): si en el dashboard de Pollar hay una regla de distribución (Treasury, Token Distribution), `/wallet` ofrece reclamarla. Paga Pollar, no nuestro servidor.
- **Montos de prueba:** 0,02 USDC por pago (es el monto por defecto y el primer botón rápido).
- **Límites:**
  - montos en stroops (BigInt), sin floats;
  - máximo 10.000 por envío en testnet;
  - límites de uso por perfil (`paymentRecord`, `paymentRead`).
- Tabla `payments` en `db/migrations/0004_pagos.sql`. En modo Supabase todavía no hay pagos.

## 9. Orden de trabajo

1. Estructura de `core/` y este documento.
2. Login con Pollar y Freighter, wallet patrocinada y saldo.
3. Perfil con @usuario y avatar.
4. Supabase: puente de sesión, tablas, RLS, comunidades y chat.
5. Conectar X, revisión de seguridad (Codex) y publicación en `kosmovia-core.vercel.app`.

## Fuentes

- Pollar: [docs](https://docs.pollar.xyz/docs) · [wallet adapters](https://docs.pollar.xyz/docs/sdk-reference/wallet-adapters) · [funding modes](https://docs.pollar.xyz/docs/core-concepts/funding-modes) · [repo](https://github.com/pollar-xyz/pollar)
- X: [precios](https://docs.x.com/x-api/getting-started/pricing) · [cuentas verificadas](https://help.x.com/en/managing-your-account/about-x-verified-accounts)
- Supabase: [precios](https://supabase.com/pricing) · [signing keys](https://supabase.com/docs/guides/auth/signing-keys)
- NFT: [SEP-50](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0050.md) · [OpenZeppelin non-fungible](https://docs.openzeppelin.com/stellar-contracts/tokens/non-fungible/non-fungible)
