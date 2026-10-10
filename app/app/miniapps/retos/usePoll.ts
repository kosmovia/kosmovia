'use client';

import { useEffect, useRef } from 'react';

/** Llama a `fn` cada `ms` mientras `enabled` y la pestaña esté visible. Al volver a verla, consulta de una vez. */
export function usePoll(fn: () => void | Promise<void>, ms: number, enabled: boolean) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState === 'visible') void ref.current();
    };
    const id = window.setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [ms, enabled]);
}
