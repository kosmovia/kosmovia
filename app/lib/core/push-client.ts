"use client";

/**
 * Ayudas del navegador para la app instalable y las notificaciones: detectar
 * soporte, suscribirse con la clave pública y guardar el evento de instalación.
 * Todo con tolerancia a fallos: nunca lanza al leer el estado.
 */

export type PermissionState = "default" | "granted" | "denied";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function notificationPermission(): PermissionState {
  if (typeof Notification === "undefined") return "default";
  return Notification.permission as PermissionState;
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ se presenta como Mac con pantalla táctil.
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

/** true si la app corre instalada (ventana propia / pantalla de inicio). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

/** Base64 URL -> bytes, el formato que pide `pushManager.subscribe`. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

/** La suscripción de ESTE dispositivo, o null. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** Suscribe este dispositivo (el permiso ya debe estar concedido). */
/** Prevent an unavailable worker from leaving activation pending forever. */
export async function withPushTimeout<T>(promise: Promise<T>, timeoutMs = 8_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Las notificaciones tardaron demasiado. Intenta de nuevo.")), timeoutMs);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function subscribeThisDevice(publicKey: string): Promise<PushSubscription> {
  const registered = await withPushTimeout(registerServiceWorker());
  if (!registered) throw new Error("No se pudo registrar las notificaciones en este navegador.");
  const reg = await withPushTimeout(navigator.serviceWorker.ready);
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  return withPushTimeout(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
}

/** Renew an existing device subscription for the authenticated profile, without prompting. */
export async function syncThisDeviceSubscription(profileId: string): Promise<boolean> {
  if (!pushSupported() || notificationPermission() !== "granted") return false;
  try {
    const sub = await withPushTimeout(currentSubscription());
    if (!sub) return false;
    const response = await fetch("/api/push/subscriptions", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...sub.toJSON(), expectedProfileId: profileId }),
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Detach only this browser before clearing its cookie; other devices stay enabled. */
export async function logoutThisDevice(): Promise<void> {
  const sub = await withPushTimeout(currentSubscription()).catch(() => null);
  try {
    await fetch("/api/auth/logout", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub ? { endpoint: sub.endpoint } : {}),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    // Still remove local push access and allow the wallet to finish signing out offline.
  } finally {
    if (sub) await withPushTimeout(sub.unsubscribe()).catch(() => false);
    try {
      const reg = await withPushTimeout(navigator.serviceWorker.getRegistration("/"));
      const notices = reg ? await withPushTimeout(reg.getNotifications()) : [];
      notices.forEach((notice) => notice.close());
    } catch {
      // Local cleanup cannot prevent signing out when a browser API fails.
    }
  }
}

// ------------------------------------------------------------ instalar app

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const KEY = "__kosmoviaInstallPrompt";
export const INSTALL_EVENT = "kosmovia:install-available";

type Holder = { [KEY]?: BeforeInstallPromptEvent | null };

/** Se llama una vez al cargar la app: el navegador dispara `beforeinstallprompt` solo una vez. */
export function captureInstallPrompt(): () => void {
  const onPrompt = (e: Event) => {
    e.preventDefault();
    (window as unknown as Holder)[KEY] = e as BeforeInstallPromptEvent;
    window.dispatchEvent(new Event(INSTALL_EVENT));
  };
  const onInstalled = () => {
    (window as unknown as Holder)[KEY] = null;
    window.dispatchEvent(new Event(INSTALL_EVENT));
  };
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

export function installPromptEvent(): BeforeInstallPromptEvent | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as Holder)[KEY] ?? null;
}

/** Abre el diálogo de instalación del navegador; true si la persona aceptó. */
export async function promptInstall(): Promise<boolean> {
  const event = installPromptEvent();
  if (!event) return false;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    (window as unknown as Holder)[KEY] = null;
    window.dispatchEvent(new Event(INSTALL_EVENT));
    return outcome === "accepted";
  } catch {
    return false;
  }
}
