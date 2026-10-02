# core · Etapa A de Kosmovia

Dueño: Alejandro. Cuentas con wallet (Pollar o Freighter), perfil con avatar generado, comunidades y chat en tiempo real. Solo testnet.

Trabajo separado de `app/` (Victor), `server/` (Roberto) y `web/` (landing): se integra cuando el equipo esté de acuerdo.

- **Probar en tu PC (Roberto, Victor, Carla):** [docs/PROBAR-EN-TU-PC.md](docs/PROBAR-EN-TU-PC.md)
- Diseño técnico: [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)
- Nunca subir claves ni archivos `.env`.

## Cómo correr la app

```bash
cd core
npm install
cp .env.example .env.local   # completa los valores; nunca subas .env.local
npm run dev                  # http://localhost:3000
```

Otros comandos: `npm run build`, `npm run start`, `npm test`.
