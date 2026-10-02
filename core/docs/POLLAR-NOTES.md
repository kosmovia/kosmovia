# Notas de Pollar · Etapa A

Qué se verificó contra el SDK (`@pollar/core` y `@pollar/react` 0.11.3, tipos y código en `node_modules`) y la documentación, y qué falta confirmar con una prueba real. Todo en testnet.

Marcas: **[verificado]** visto en tipos, código o documentación. **[sin confirmar]** hay que probarlo con una clave real.

## Login

- **[verificado]** `login({ provider: "google" })`, `openLoginModal()` (el modal incluye email con código) y `login({ provider: WalletType.FREIGHTER })` existen con esos nombres.
- **[verificado]** Hay un solo `PollarClient`, guardado en `globalThis` (si hay dos, la rotación de refresh tokens desloguea al usuario).
- **[sin confirmar]** Que Google y email estén activos depende de lo que se configure en el dashboard de Pollar (ver abajo). El botón de Google falla si el proveedor no está habilitado.

## Patrocinio de la cuenta y la trustline de USDC

Lo que expone el SDK y lo que usa `hooks/useAccountSetup.tsx`:

| Caso | Qué hace el código | Estado |
| --- | --- | --- |
| Google / email (wallet `internal`, modo IMMEDIATE) | Pollar crea la cuenta en el servidor al entrar. Luego `refreshAssets()` y `setTrustline({ code, issuer })` para cada activo habilitado sin trustline. | Tipos y comentarios del SDK: **[verificado]**. Que funcione de punta a punta: **[sin confirmar]** |
| Freighter (wallet `external`, IMMEDIATE) | Si `wallet.existsOnStellar === false`: `client.createAccount()` (Pollar arma un `createAccount` patrocinado, firma solo al patrocinador, y Freighter firma como cuenta nueva). Luego `setTrustline`, que para wallets externas usa `/wallet/assets/trustline/build` (XDR firmado por el patrocinador, Freighter agrega su firma). | Rutas y flujo en el SDK: **[verificado]**. La condición de `existsOnStellar` es la misma que usa el botón de crear cuenta del propio `WalletButton`. Falta probar con Freighter real: **[sin confirmar]** |
| Wallet `internal` en modo DEFERRED | `POST /api/wallet/fund` (servidor) llama a Pollar con `POLLAR_SECRET_KEY`. | Ver "Fund vs activate". |
| Wallet `smart` (passkey, C...) | No se ofrece en el login. El código la ignora. | Fuera de la etapa A |

**Fund vs activate.** **[verificado en la documentación oficial]** (`docs.pollar.xyz/docs/core-concepts/funding-modes` y `llms-full.txt`): `POST https://server.api.pollar.xyz/v1/wallets/fund`, header `x-pollar-api-key: sec_testnet_...`, cuerpo `{ "publicKey": "G..." }`. Respuestas: 200 fondeada, 409 ya fondeada (se ignora), 402 la wallet de fondeo no tiene XLM, 404 la dirección no es una wallet de la app. La nota de Pollar Pass hablaba de `/v1/wallets/activate`; la documentación actual solo menciona `/fund`, y `activate` no aparece en los tipos del SDK. Usamos `/fund`. **[sin confirmar]** que el nombre de la ruta y el cuerpo sigan así: nunca se llamó con una clave real. Solo aplica a apps en modo DEFERRED; en IMMEDIATE no hace falta.

El servidor solo acepta una clave `sec_testnet_` y solo fondea la dirección que salió de verificar la firma, nunca una enviada en el cuerpo.

**Fee-bump para Freighter.** La documentación dice que cada transacción enviada por el SDK se envuelve en un fee-bump pagado por la wallet de gas de la app, y los tipos de `/tx/build` aceptan opciones de patrocinio (`skipSponsorship`). **[sin confirmar]** que esto cubra también los pagos firmados con Freighter: la documentación de funding modes no trata wallets externas. En la etapa A no enviamos pagos, así que no se usa; hay que probarlo antes de la etapa C.

**Costos y límites [verificado en docs]:** 1 XLM de reserva más 0,5 XLM por trustline salen de la wallet de fondeo de la app; en testnet se carga con Friendbot. 1.000 requests por día en testnet.

## Identidad en el servidor (SEP-53)

- **[verificado]** Las sesiones de Pollar son DPoP: reenviar su token no prueba nada en nuestro servidor. Por eso el cliente firma `kosmovia-auth:v1:{METHOD} {ruta}:{dirección}:{vence}` con `client.stellar.sep53.signMessage` (2 minutos) y manda el header `x-kosmovia-proof` (JSON `{ address, exp, signature }`).
- El servidor (`lib/auth.ts`, `requireSignedAddress()`) verifica ed25519 con `node:crypto` sobre `SHA-256("Stellar Signed Message:\n" + mensaje)`. Rechaza pruebas vencidas, con más de 3 minutos de vida, de otra ruta o método, con la dirección cambiada, y todo lo que no sea una dirección `G...`. Los tests lo cubren con claves generadas en la prueba.
- **[verificado en tipos]** Para wallets custodiales la firma se hace en el servidor de Pollar (`/stellar/sep53/sign`); para Freighter, en el navegador. **[sin confirmar]** que `signMessage` de Freighter funcione en la versión instalada (Albedo no firma mensajes).
- `POST /api/auth/session` devuelve `{ address }`. Hay un TODO marcado en `app/api/auth/session/route.ts` donde se emitirá el JWT de Supabase (sección 2 de `ARQUITECTURA.md`).

### Cuentas C (smart accounts, passkey) más adelante

Una cuenta `C...` no tiene una clave ed25519 que sirva de dirección, así que `verifySep53` no sirve. Hará falta una de estas dos cosas, y mientras tanto `requireSignedAddress` las rechaza (cierra por defecto):

1. Verificar la aserción WebAuthn del passkey (clave P-256) contra la clave pública registrada, o
2. Llamar a `__check_auth` de la cuenta de contrato por simulación en RPC.

Cualquiera de las dos cambia el formato del header; habrá que subir la versión del mensaje (`kosmovia-auth:v2`).

## Saldos y fondos de prueba

- Los saldos salen de Horizon testnet (`https://horizon-testnet.stellar.org`), en cadenas decimales, sin floats. USDC se reconoce por el emisor de Circle en testnet.
- "Recargar XLM de prueba" llama a Friendbot desde el navegador y solo existe para testnet (la red está fija en el código). Si la cuenta ya fue fondeada, Friendbot responde error y se muestra un mensaje amable.
- USDC de prueba: `faucet.circle.com` (elegir Stellar y testnet). Hay que tener la trustline antes; el flujo de arriba la crea.

## Qué configurar en el dashboard de Pollar para probar de punta a punta

1. Crear una app **en testnet** (`dashboard.pollar.xyz`, Build, API Keys). Copiar la clave publicable `pub_testnet_...` a `core/.env.local` como `NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY`. La secreta `sec_testnet_...` (`POLLAR_SECRET_KEY`) solo hace falta si la app queda en modo DEFERRED.
2. Habilitar los métodos de login: **Google**, **Email** y **Freighter** (wallets externas).
3. Habilitar el activo **USDC** de testnet (emisor `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`) en los activos de la app, con **patrocinio de trustline activado**.
4. Modo de fondeo **IMMEDIATE** (más simple). Si se elige DEFERRED, hace falta `POLLAR_SECRET_KEY`.
5. Cargar la **wallet de fondeo (gas) de la app** con XLM de testnet usando Friendbot. Sin saldo, la creación de cuentas y las trustlines fallan (402).
6. Topes de gasto: `max_fee_per_tx` y `daily_ops_cap` según convenga.
7. Si el dashboard pide orígenes permitidos: `http://localhost:3000` (y el dominio de Vercel después).
8. Tener la extensión **Freighter** instalada y puesta en **Testnet** para probar ese botón.
