# Supabase · Etapa A

Base de datos, reglas de acceso (RLS) y chat en tiempo real de `core/`. Todo corre en el plan gratis.

## Aplicar la migración

1. Crea un proyecto en [supabase.com](https://supabase.com) (plan Free).
2. Aplica `migrations/0001_stage_a.sql` y, después, `migrations/0002_hardening.sql` (cuotas, CHECKs, rol `kosmovia_verifier`). Hay dos caminos:
   - **Panel:** SQL Editor, New query, pega el contenido de cada archivo (en orden) y pulsa Run.
   - **CLI:** `npx supabase login`, `npx supabase link --project-ref <ref>` y `npx supabase db push` (desde `core/`).
3. Revisa en Table Editor que existan `profiles`, `communities`, `members`, `channels` y `messages`, todas con RLS activada, y que `messages` aparezca en Database, Publications, `supabase_realtime`.

La migración no usa la `service_role` ni Supabase Auth: la identidad sale del JWT que firma nuestro servidor.

## Clave de firma del JWT (ES256)

El servidor firma el token de sesión (`POST /api/auth/session`) con una clave nuestra, y Supabase la acepta como clave de firma personalizada.

1. Genera un par ES256 (P-256) en tu máquina, fuera del repo:

   ```bash
   openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out kosmovia-jwt.pem
   ```

   Los `*.pem` ya están en `.gitignore`. Nunca los subas.
2. En el panel: **Authentication, JWT Keys (Signing Keys)**. Importa la clave privada (**Import an existing private key**, formato PEM/JWK, algoritmo ES256). Supabase te muestra su `kid`.
3. Cópialo en las variables de entorno del servidor (`.env.local` y Vercel):
   - `SUPABASE_JWT_PRIVATE_KEY`: el PEM completo. En una sola línea sirven los `\n` literales.
   - `SUPABASE_JWT_KEY_ID`: el `kid` de esa clave. El token lo lleva en la cabecera.
4. Deja la clave importada como **Current** (en uso). Sin eso, Supabase rechaza los tokens.

## Variables de entorno

| Variable | Dónde se usa | Secreta |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | navegador | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | navegador (clave anon/publishable) | no |
| `SUPABASE_JWT_PRIVATE_KEY` | solo servidor | **sí** |
| `SUPABASE_JWT_KEY_ID` | solo servidor | no |

Sin ellas, la app compila y muestra "Falta configurar Supabase".

## Cómo se relaciona el JWT con la base

- `sub` del token es un UUID v5 derivado de la wallet (`lib/ids.ts`). Es el mismo `id` de la fila en `profiles`: no hace falta consultar la base para emitir el token.
- `wallet` es la dirección Stellar. La política de inserción de `profiles` exige que coincida con la de la fila.
- Las políticas leen todo con `auth.jwt()` (ver `current_profile_id()` en la migración).

## Endurecimiento (0002) y cuotas

`migrations/0002_hardening.sql` no reescribe la 0001. Agrega:

| Qué | Límite | Cómo |
| --- | --- | --- |
| Comunidades creadas por perfil | 3 cada 24 h y 10 en total | trigger `BEFORE INSERT` en `communities` |
| Mensajes por autor | 20 por minuto y 500 por hora | trigger `BEFORE INSERT` en `messages` |
| Canales por comunidad | 50 | trigger `BEFORE INSERT` en `channels` |
| `avatar_seed` | 1 a 64 caracteres de `A-Za-z0-9:_.-` | CHECK |
| `avatar_style` | solo los estilos del generador | CHECK (un test compara la lista con `AVATAR_STYLES`) |
| `x_handle` | formato de usuario de X; único sin importar mayúsculas | CHECK + índice único parcial |
| `communities.icon` (16) y `channels.topic` (200) | largo máximo | CHECK |

- Los triggers son `SECURITY DEFINER` con `search_path` vacío y toman un `pg_advisory_xact_lock` por usuario (o por comunidad) antes de contar, así que dos inserts a la vez no se cuelan por la misma ventana. Los conteos usan los índices nuevos `communities_owner_created_idx` y `messages_author_created_idx`.
- Al pasarse de un límite la base responde con el mensaje `quota_exceeded:<tipo>` (SQLSTATE `P0001`); el cliente lo traduce (`quotaMessage` en `lib/mappers.ts`).
- `profiles.display_name` (40) y `profiles.bio` (280) ya tenían su CHECK en la 0001, por eso no se repiten.
- Si ya hay filas que no cumplen un CHECK (o dos perfiles con el mismo `x_handle`), la migración falla: corrígelas antes. En una base nueva no pasa nada.
- Límite conocido: los mensajes borrados dejan de contar para la cuota (se cuenta lo que existe). Borrar y reenviar en bucle sigue siendo posible; el cierre es una tabla de contadores, pendiente.

## Rol `kosmovia_verifier` (guardar la verificación de X sin service_role)

Después de verificar la publicación en X, `POST /api/x/verify` guarda `x_handle`, `x_verified_at` y `trust_level = 1` en el perfil. Los usuarios no pueden escribir esas columnas (permiso por columna) y no usamos la `service_role`. En su lugar:

1. La migración crea el rol `kosmovia_verifier` (`NOLOGIN`) y se lo concede a `authenticator`, para que PostgREST pueda cambiar a él:

   ```sql
   grant kosmovia_verifier to authenticator;
   ```

   La migración ya lo hace si existe `authenticator`. Repítelo a mano si tu proyecto lo necesita.
2. Permisos mínimos sobre `profiles`: `select (id, wallet)` y `update (x_handle, x_verified_at, trust_level)`, y `usage` en el esquema `public`. Nada más.
3. Política RLS `profiles_verifier_update`: solo `UPDATE`, y solo si `trust_level <= 1` después del cambio. Un trigger refuerza que el rol nunca fije el nivel 2, no toque perfiles que ya son nivel 2 y deje el nivel en 1.
4. El servidor firma un JWT de **2 minutos** con `role: "kosmovia_verifier"` (`signVerifierJwt` en `lib/jwt.ts`, la misma clave ES256 y `kid` que las sesiones) y llama a `PATCH ${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/profiles?id=eq.<uuid v5 de la wallet>&wallet=eq.<wallet>` con `apikey` (anon) y `Authorization: Bearer <token>`.
5. Si el `x_handle` ya lo tiene otro perfil, el índice único responde 23505 (HTTP 409) y la ruta contesta 409 `x_taken`: "Esa cuenta de X ya está vinculada a otro perfil".

**Supabase debe aceptar JWT con este rol.** Con una clave de firma importada (sección de arriba), PostgREST valida el token y hace `SET ROLE` al valor de `role`. Hay que probarlo en un proyecto real (ver `tests/README.md`, sección "Verificador"). Si tu proyecto rechaza el rol, el guardado devuelve `persisted: false` y la verificación se sigue mostrando sin guardarse. Sin Supabase configurado la ruta también devuelve `persisted: false`.

## Notas

- `trust_level`, `x_handle` y `x_verified_at` no son editables por el usuario (permisos por columna). Solo los escribe el servidor, con el rol `kosmovia_verifier` (sección anterior).
- Para probar las políticas a mano: `tests/README.md`.
