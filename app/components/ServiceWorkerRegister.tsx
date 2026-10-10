'use client';

import { useEffect } from 'react';
import { captureInstallPrompt, registerServiceWorker } from '../lib/core/push-client';

/**
 * Registra el service worker (/sw.js) y guarda el evento de "instalar app".
 * Corre también en desarrollo: sw.js solo maneja push y no guarda nada en caché,
 * así que no estorba al recargar en caliente.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    const stop = captureInstallPrompt();
    void registerServiceWorker();
    return stop;
  }, []);
  return null;
}
