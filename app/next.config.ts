import type { NextConfig } from 'next';

/**
 * Una sola app: el frontend y el backend (rutas /api, en app/api) corren en el
 * mismo servidor, así la cookie de sesión y el login con Pollar usan el mismo origen.
 */
const nextConfig: NextConfig = {
  // El indicador de desarrollo de Next tapaba la barra izquierda.
  devIndicators: { position: 'bottom-right' },
  // pg y sharp (nativo, para recodificar los adjuntos) son módulos de Node: que Next no los empaquete.
  serverExternalPackages: ['pg', 'sharp'],
};

export default nextConfig;
