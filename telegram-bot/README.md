# Un pequeño espacio 🌷

Bot nativo de Telegram, sin web. Acceso abierto en chats privados, historial por usuario, textos breves, postales pastel y hora de Bolivia. Python 3.12.

## Ejecutar

Desde esta carpeta:

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
# Si aún no existe: copia .env.example a .env y completa las claves.
.venv/Scripts/python bot.py
```

En Linux: usa `.venv/bin/python`. Edita `messages.json` para mensajes personales; reinicia después. No incluyas información sensible: el bot está abierto. Para acceso restringido, configura `AUTHORIZED_IDS=123,456`; cada persona puede consultar `/id`.

## IA y costos

Por defecto no se hacen llamadas de generación ni cargos: textos locales y postales con Pillow. Para texto IA, usa una clave válida de un proyecto Gemini **sin facturación habilitada** y configura `GEMINI_FREE_TIER_CONFIRMED=true`. El programa no puede comprobar la facturación de Google desde la clave. Modelo: `gemini-3.1-flash-lite`. Nunca envía IDs a Gemini; sí los últimos mensajes de esa categoría.

La API Gemini de imágenes no tiene nivel gratuito. Integración preparada para `gemini-3.1-flash-image`, desactivada por defecto. Solo si decides usar pago: `ALLOW_PAID_IMAGES=true` y un presupuesto positivo. Cada intento reserva USD 0.10 antes de la llamada (también los fallidos), y se limita la salida a una imagen. Es un límite estimado de esta instancia, no sustituye los controles de facturación del proveedor. Las frases se dibujan localmente para mantenerlas legibles. Ante fallos, genera una postal local.

Límites predeterminados: 30 solicitudes y 5 postales diarias por usuario, 8 segundos entre solicitudes, 40 llamadas IA globales por día; reinicio del día a medianoche de Bolivia. SQLite conserva los últimos 600 mensajes por usuario y evita repeticiones recientes. Una biblioteca finita puede volver a aparecer después de agotar su ventana. Una sola instancia; no ejecutar Docker y polling local simultáneamente.

## Docker 24/7

```sh
docker compose up -d --build
docker compose logs --tail=30
docker compose down
```

Necesita un equipo encendido con Docker y conexión permanente. `restart: unless-stopped`, ejecución sin root y volumen persistente `bot-data`. No publica puertos. La imagen no contiene `.env`; Compose lo inyecta al ejecutar. No borrar el volumen si quieres conservar historial y límites. Un archivo Docker preparado no equivale a un despliegue verificado. No se ha configurado hosting.

## Verificar

```powershell
.venv/Scripts/python -m unittest -v
.venv/Scripts/python check_connections.py
```

Las pruebas unitarias no contactan Telegram. La comprobación real valida `getMe`, webhook y la clave Gemini, sin enviar mensajes ni generar imágenes. Para prueba de extremo a extremo: inicia el proceso, abre el bot, usa `/start`, prueba las seis opciones, “Otra más” e “Inicio”; confirma la imagen y la firma. Esto requiere interacción real en Telegram.

Los secretos se leen del entorno o `.env` ignorado por Git, nunca se imprimen ni se incluyen en la imagen. No publicar claves en chats; rota las claves compartidas antes de uso estable. Logs sin URLs ni contenido de excepciones. Dependencias gratuitas: python-telegram-bot (LGPL), Pillow (HPND), python-dotenv (BSD), tzdata (Apache).

Validación realizada el 11/10/2026: 9 pruebas locales correctas; Telegram `getMe` y `getUpdates` reales correctos; una generación de texto Gemini real correcta. Proceso local iniciado en Windows, sin garantía de continuidad al apagar el equipo. Docker no disponible en este entorno: build y ejecución del contenedor pendientes. Interacción de extremo a extremo desde la cuenta de una persona pendiente.

Referencias: [python-telegram-bot](https://docs.python-telegram-bot.org/en/stable/), [Gemini y precios](https://ai.google.dev/gemini-api/docs/pricing).
