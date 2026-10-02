# Base de datos para pruebas (modo "api")

Esta carpeta es el **camino alterno** a Supabase: la etapa A corre contra un Postgres plano (por ejemplo la base de **pruebas** de Roberto en Render), sin Supabase Auth, RLS ni Realtime. Es solo para probar. **No es producción** y no se debe apuntar a una base con datos reales.

El camino de Supabase (`supabase/`) sigue intacto y es el que queda por defecto.

## Cómo funciona

```
navegador ──(cookie httpOnly kosmovia_session)──▶ rutas /api de Next ──(pg, consultas parametrizadas)──▶ Postgres
```

- **Sesión.** El login con Pollar y la prueba SEP-53 no cambian. `POST /api/auth/session` verifica la firma y, en vez del JWT de Supabase, pone la cookie `kosmovia_session`: un JWT HS256 firmado con `SESSION_SECRET` (mínimo 32 bytes), válido 12 horas, `httpOnly`, `SameSite=Lax` y `Secure` en producción. Claims: `sub` (UUID v5 de la wallet = `profiles.id`), `wallet`, `iat`, `exp`. El cuerpo de la respuesta no lleva token: `{ address, profileId, expiresAt, backend: "api" }`. `POST /api/auth/logout` borra la cookie. Detalle en `lib/session-cookie.ts`.
- **Autorización en el servidor.** Sin RLS, las reglas viven en `lib/authz.ts` (funciones puras) y se aplican en `lib/db/repo.ts` y las rutas: solo los miembros leen canales y mensajes; en `text` escribe cualquier miembro y en `announcement` solo `owner` y `admin`; solo `owner` y `admin` crean canales; el autor de un mensaje es siempre el perfil de la sesión; unirse es siempre como `member`. El INSERT del mensaje repite la regla dentro de la propia consulta, así que no se puede esquivar con una carrera.
- **SQL.** Todas las consultas están en `lib/db/sql.ts` con `$1, $2, ...`: ningún dato del usuario entra al texto SQL (hay tests que lo comprueban con entradas hostiles).
- **Cuotas.** Siguen siendo triggers atómicos en la base (3 comunidades por 24 h y 10 en total, 20 mensajes por minuto y 500 por hora, 50 canales por comunidad). Sus errores `quota_exceeded:*` salen como 429 con el mismo mensaje en español de siempre. Además hay límites en memoria por perfil en las escrituras (`lib/api-limits.ts`).
- **Tiempo real.** No hay Realtime: el chat abierto consulta `GET /api/channels/[id]/messages?after=<último id>` cada 2,5 s mientras la pestaña está visible (en pausa si está oculta, con una consulta inmediata al volver). Conserva la ventana de 200 mensajes y "Cargar anteriores". Los mensajes se piden con una ventana que retrocede 5 s para no perder uno que se confirme tarde; el cliente quita los repetidos por id.
- **Verificar X.** Con `KOSMOVIA_DATA_BACKEND=api`, `/api/x/verify` guarda `x_handle`, `x_verified_at` y `trust_level = 1` directo en la base. Una cuenta de X sigue siendo de un solo perfil (409 `x_taken`) y nunca se fija el nivel 2.

## Variables de entorno (nombres, nunca valores)

| Variable | Dónde | Para qué |
| --- | --- | --- |
| `KOSMOVIA_DATA_BACKEND=api` | servidor | enciende las rutas REST y la cookie |
| `NEXT_PUBLIC_KOSMOVIA_DATA_BACKEND=api` | navegador | hace que los hooks usen las rutas `/api` en vez de Supabase |
| `DATABASE_URL` | servidor | `postgresql://usuario:clave@host/base` |
| `SESSION_SECRET` | servidor | clave HMAC de la cookie, 32 bytes o más (por ejemplo `openssl rand -hex 32`) |
| `DATABASE_SSL` | servidor, opcional | `verify` (por defecto), `no-verify` u `off`, ver TLS |

Las dos primeras deben tener el mismo valor. `NEXT_PUBLIC_*` se fija al arrancar `next dev` o al hacer `next build`: reinicia el servidor si la cambias.

## Aplicar el esquema

```bash
cd core
npm run db:migrate   # aplica db/migrations/*.sql que falten (lleva la cuenta en schema_migrations)
npm run db:check     # solo lectura: lista las tablas y cuenta las filas de cada una
```

`0001_stage_a.sql` equivale a `supabase/migrations/0001` + `0002` sin lo propio de Supabase (no hay `auth.jwt()`, RLS, roles `anon`/`authenticated`/`authenticator`, publicación `supabase_realtime` ni el rol `kosmovia_verifier`). Es idempotente y pide Postgres 13 o más. Los scripts leen `DATABASE_URL` de `core/.env.local` o del entorno, y nunca imprimen la URL ni los mensajes de errores de red.

## TLS con Render

Render exige TLS en las conexiones externas. Se usa `ssl: { rejectUnauthorized: true }` (verificación completa): **con la base de Render probada funciona tal cual**, la cadena de certificados se valida con los CAs del sistema de Node. Si en otra base la cadena no se pudiera verificar, el error dirá `... (el certificado TLS del servidor no se pudo verificar)`; solo entonces se puede poner `DATABASE_SSL=no-verify` (cifrado, pero sin comprobar quién responde). Para una base local sin TLS (`localhost`) se desactiva solo.

## Probar de punta a punta (sin la UI de Pollar)

```bash
cd core
npm run dev            # una terminal, http://localhost:3000
npm run smoke:api      # otra terminal
```

`scripts/smoke-api.mjs` genera dos wallets desechables en memoria, firma la prueba SEP-53 de cada una, y recorre: sesión por cookie, perfil `@prueba_kosmo`, comunidad "Prueba Kosmovia", mensaje en `#general`, lectura, un no miembro denegado (403), un miembro que no puede escribir en `#anuncios`, y que un `Origin` ajeno no pasa. Al final borra de la base **solo** las filas de esos dos perfiles (por su id), incluso si un paso falla. Cada corrida usa wallets nuevas, así que se puede repetir. Con otra URL: `SMOKE_BASE_URL=http://localhost:3130 npm run smoke:api`.

## Volver a Supabase

Quita (o deja vacías) `KOSMOVIA_DATA_BACKEND` y `NEXT_PUBLIC_KOSMOVIA_DATA_BACKEND` y reinicia. Sin ellas el valor por defecto es `supabase`: las rutas REST de esta carpeta responden 404 `backend_disabled`, `POST /api/auth/session` vuelve a emitir el JWT de Supabase y los hooks vuelven a hablar con Supabase. `DATABASE_URL` y `SESSION_SECRET` dejan de usarse. Las dos bases no comparten datos.

## Qué falta o es distinto frente a Supabase

- No hay empuje en tiempo real: el chat tarda hasta ~2,5 s en mostrar un mensaje ajeno, y cada pestaña abierta es una consulta cada 2,5 s.
- La cookie es sin estado: cerrar sesión la borra del navegador, pero una copia robada sirve hasta que venza (12 h). Si hiciera falta revocar, habría que guardar sesiones en la base.
- Los límites de `lib/api-limits.ts` y `lib/rate-limit.ts` son en memoria y por instancia (en serverless son orientativos); lo firme son los triggers.
- El esquema no tiene RLS: quien tenga `DATABASE_URL` ve y escribe todo. Úsala solo en la base de pruebas.
