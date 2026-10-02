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
