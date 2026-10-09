# Kosmovia · logo

El símbolo es una **K con una órbita y dos cuerpos**: la comunidad (la K) y lo que se mueve a su alrededor, pagos y personas (un planeta hueco arriba y una luna llena abajo). La órbita se corta alrededor de cada cuerpo, para que se lea que pasan por ella. Plano, sin brillo ni degradados.

## Colores

| Uso | Color |
| --- | --- |
| Símbolo | `#00F2FE` (cian) |
| Fondo | `#05080C` (casi negro) |
| Texto | `#F0FDFA` |
| Texto secundario | `#809CA8` |

Tipografía del nombre: **Outfit** (Google Fonts, gratis), en negrita y minúsculas: `kosmovia`. Si no está, Century Gothic.

## Archivos (`kit/`)

| Archivo | Para qué |
| --- | --- |
| `kosmovia-mark.svg` / `kosmovia-mark-1024.png` | Símbolo solo, fondo transparente |
| `kosmovia-mark-white.svg` / `kosmovia-mark-white-1024.png` | Símbolo en blanco, para fondos de color |
| `kosmovia-icon.svg`, `icon-512.png`, `icon-192.png`, `favicon-32.png` | Ícono de app y favicon (cuadrado redondeado) |
| `apple-icon-180.png` | Ícono de iPhone |
| `perfil-redes-1080.png` | Foto de perfil en X, Instagram, LinkedIn y TikTok |
| `og-1200x630.png` | Vista previa al compartir el enlace |
| `banner-x-1500x500.png`, `banner-linkedin-1584x396.png` | Portadas de redes |
| `logo-horizontal-1600x600.png` | Símbolo + nombre, para presentaciones |

## Reglas

- No agregar brillo, sombras ni degradados.
- Dejar aire alrededor: al menos el ancho del punto de la órbita.
- Tamaño mínimo: 16 px (favicon). Para menos de 48 px se usa `kosmovia-icon.svg`, que tiene la órbita más gruesa.

## Regenerar

El símbolo se dibuja con código en `build.mjs` (usa `sharp`, que ya viene en `app/node_modules`):

```bash
cd design/brand && node build.mjs
```
