# Probar `core` en tu PC

Unos 10 minutos. Solo testnet: nada usa dinero real.

## 1. Requisitos
- Node 22 o más nuevo (`node -v`).
- Git y acceso al repo `kosmovia/kosmovia`.

## 2. Bajar el código
```bash
git clone https://github.com/kosmovia/kosmovia.git
cd kosmovia
git checkout feat/core-stage-a   # cuando se una a main, basta con main
cd core
npm install
cp .env.example .env.local
```

## 3. Completar `.env.local`
**Nunca subas este archivo ni pegues sus valores en el chat del grupo ni en GitHub.** Los valores que no generas tú se pasan por mensaje privado.

| Variable | Valor |
| --- | --- |
| `NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY` | Te la pasa Alejandro por privado. |
| `KOSMOVIA_DATA_BACKEND` | `api` |
| `NEXT_PUBLIC_KOSMOVIA_DATA_BACKEND` | `api` |
| `DATABASE_URL` | La base de pruebas de Render: te la pasa Roberto por privado. |
| `SESSION_SECRET` | Genera el tuyo (comando abajo). |
| `X_CHALLENGE_SECRET` | Genera el tuyo (comando abajo). |

Las demás variables (Supabase y `POLLAR_SECRET_KEY`) quedan vacías.

Para generar cada secreto, corre esto y copia el resultado:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## 4. Correr
```bash
npm run dev
```
Abre **http://localhost:3000**. Tiene que ser el puerto 3000: es el único autorizado en Pollar.

## 5. Qué probar
1. **Entrar** con Google, email o Freighter (Freighter en testnet).
2. **Crear perfil** (`/perfil/nuevo`):
   - elige un @usuario de las sugerencias o usa Aleatorio;
   - arma tu Kosmonauta: flechas por rasgo, candados y Aleatorio.
3. **Perfil** (`/perfil`): cambia el @usuario (1 vez cada 24 h) y el Kosmonauta (1 vez cada 3 días).
4. **Comunidades:** crea una, entra a sus canales y escribe en el chat.

Todos usamos la misma base de pruebas, así que vas a ver los usuarios y las comunidades de los demás. Pueden chatear entre ustedes.

## Si algo falla
- **El login no abre o dice "origin not allowed":** revisa que estés en `http://localhost:3000`.
- **"Falta configurar la base de datos":** falta `DATABASE_URL` o `KOSMOVIA_DATA_BACKEND=api`.
- **Tests:** `npm test` corre sin red ni base.
