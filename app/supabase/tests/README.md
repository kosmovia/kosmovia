# Probar las políticas RLS a mano

Cuando exista el proyecto de Supabase. Hacen falta dos usuarios de prueba (A y B) con perfil creado desde la app, en testnet y con datos ficticios. Usa dos ventanas con sesiones distintas, o el SQL Editor con un token firmado para cada uno (`set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>","wallet":"G..."}';`).

## Perfiles
- [ ] Sin sesión se leen los perfiles (permitido).
- [ ] A edita su propio nombre y avatar (permitido).
- [ ] A edita el perfil de B (0 filas afectadas).
- [ ] A crea un perfil con el `id` de B, o con una wallet distinta a la de su token (denegado).
- [ ] A cambia su propio `trust_level`, `x_handle` o `x_verified_at` (denegado: permiso por columna).
- [ ] Un `username` repetido, aunque cambie mayúsculas, falla con violación de unicidad (23505).

## Comunidades
- [ ] Sin sesión se listan las comunidades (permitido).
- [ ] A crea una comunidad con `owner_id` = A (permitido). Aparecen A como `owner`, el canal `general` (text) y `anuncios` (announcement).
- [ ] A crea una comunidad con `owner_id` = B (denegado).
- [ ] Un slug repetido o con formato inválido (mayúsculas, espacios) falla.

## Miembros
- [ ] B ve la lista de miembros solo de las comunidades donde es miembro (denegado en las demás).
- [ ] B se une como `member` (permitido). B se une como `admin` u `owner` (denegado).
- [ ] B une a otra persona (`profile_id` distinto del suyo) (denegado).
- [ ] B (member) cambia roles (denegado). A (owner) sube a B a `admin` (permitido). A cambia el rol del owner o pone a alguien como `owner` (denegado).
- [ ] B sale de la comunidad (permitido). A (owner) sale (denegado).

## Canales
- [ ] B, no miembro, no ve los canales (denegado). Como miembro sí (permitido).
- [ ] B (member) crea o edita un canal (denegado). A (owner) o un admin sí (permitido).

## Mensajes
- [ ] B, no miembro, no lee ni escribe mensajes (denegado).
- [ ] B (member) escribe en `general` (permitido), con `author_id` = B.
- [ ] B escribe con `author_id` = A (denegado).
- [ ] B (member) escribe en `anuncios` (denegado). A (owner/admin) sí (permitido).
- [ ] Un mensaje vacío o de más de 2000 caracteres falla.
- [ ] Nadie edita mensajes (UPDATE sin efecto). B borra su mensaje (permitido) y el de A (denegado).
- [ ] Realtime: con la ventana de A abierta en `general`, el mensaje de B aparece sin recargar. Un usuario que no es miembro no recibe el evento.

## Token
- [ ] Un token vencido, con otra `kid` o firmado con otra clave devuelve 401 de PostgREST.

## Cuotas (0002_hardening.sql)
- [ ] A crea 3 comunidades seguidas (permitido). La 4ª falla con `quota_exceeded:communities_per_day`. Con 10 en total falla con `communities_total`.
- [ ] B envía 20 mensajes en un minuto (permitido). El 21º falla con `quota_exceeded:messages_per_minute`. Con 500 en una hora falla con `messages_per_hour`.
- [ ] Dos inserts simultáneos de B justo en el límite: solo uno pasa (advisory lock).
- [ ] Una comunidad con 50 canales: el 51º falla con `quota_exceeded:channels_per_community`.

## Perfil (0002)
- [ ] `avatar_seed` con más de 64 caracteres, con espacios o con `"><script>` falla (23514). `avatar_style` = `hack` falla.
- [ ] Dos perfiles con el mismo `x_handle` (aunque cambie mayúsculas) fallan con 23505.

## Verificador (rol `kosmovia_verifier`)
Con un JWT de 2 minutos con `role: kosmovia_verifier` (firmado con la clave de sesiones), contra PostgREST:
- [ ] `PATCH profiles?id=eq.<A>&wallet=eq.<wallet de A>&select=id` con `{ "x_handle": "ana", "x_verified_at": "...", "trust_level": 1 }` devuelve la fila (permitido).
- [ ] Lo mismo con `"trust_level": 2` falla (42501). Con un perfil que ya es nivel 2 falla.
- [ ] Cambiar `username`, `bio`, `avatar_seed` o `wallet` falla (permiso por columna).
- [ ] Leer `profiles?select=bio` o `select=trust_level` falla (solo `id, wallet`); leer otras tablas (`messages`, `members`) falla.
- [ ] Un segundo perfil con el mismo `x_handle` devuelve 409 (23505).
- [ ] Si el PATCH da "permission denied" por usar `trust_level` dentro de la política, concede `select (trust_level)` al rol y anótalo aquí.
- [ ] Si PostgREST rechaza el token por el rol: revisa `grant kosmovia_verifier to authenticator;` y que la clave importada esté como Current.
