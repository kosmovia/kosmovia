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

- **Generador propio** en SVG, a partir de una semilla. Solo usa la paleta de Kosmovia: `#061314`, `#0B1F21`, `#14B8A6`, `#2DD4BF`, `#5EEAD4` y `#F2FBFA`.
- **Temas:** astronauta con casco y visor, planeta con anillos, constelación, cohete, nebulosa y portal de anillos, sobre un fondo de estrellas.
- **Al registrarse:**
  - se muestran **6 sugerencias** generadas desde la dirección de la wallet;
  - el botón **"Aleatorio"** genera otras;
  - el usuario elige una.
- **Se guarda solo `avatar_seed` y `avatar_style`.** El SVG se vuelve a dibujar igual en cualquier lado, sin ocupar almacenamiento.
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

`NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY` · `POLLAR_SECRET_KEY` · `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_JWT_PRIVATE_KEY` · `SUPABASE_JWT_KEY_ID`

## 8. Orden de trabajo

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
