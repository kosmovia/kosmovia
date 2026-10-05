# lib/core: el backend de Kosmovia

Lógica del servidor y del cliente que usan las rutas `/api` (en `app/api`) y la capa de servicios: login con Pollar, sesión (cookie httpOnly firmada con SEP-53), base de datos (`db/`), comunidades, roles, pagos verificados en Horizon y verificación de X. Antes vivía en la carpeta `core/`; desde el 05/10 todo corre en esta única app.

Los tests están en `app/tests` (`npm test`).
