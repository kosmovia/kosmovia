# Supabase · Etapa A

Base de datos, reglas de acceso (RLS) y chat en tiempo real de `core/`. Todo corre en el plan gratis.

## Aplicar la migración

1. Crea un proyecto en [supabase.com](https://supabase.com) (plan Free).
2. Aplica `migrations/0001_stage_a.sql`. Hay dos caminos:
   - **Panel:** SQL Editor, New query, pega el contenido del archivo y pulsa Run.
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

## Notas

- `trust_level`, `x_handle` y `x_verified_at` no son editables por el usuario (permisos por columna). Quien los escriba tras verificar X debe hacerlo desde un camino de confianza del servidor.
- Para probar las políticas a mano: `tests/README.md`.
