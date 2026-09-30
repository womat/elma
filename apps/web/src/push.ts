import { api } from "./api.ts";

export type PushState =
  | "unsupported" // Browser kann kein Web-Push
  | "ios-install" // iPhone: nur als installierte App (Home-Bildschirm) möglich
  | "denied" // Nutzer hat Benachrichtigungen blockiert
  | "off"
  | "on";

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function getPushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return "ios-install";
  if (!("PushManager" in window) || !("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await registration();
  if (!reg) return "unsupported";
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

function base64UrlToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Fragt nach Erlaubnis, abonniert Push und meldet das Abo beim Backend an. */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";

  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api.pushKey();
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) }));
  await api.pushSubscribe(sub.toJSON());
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe();
  }
  return "off";
}

/** Abo nach dem Login erneut ans Backend melden (z. B. nach Neuinstallation oder Kontowechsel). */
export async function syncPushSubscription(): Promise<void> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub && Notification.permission === "granted") await api.pushSubscribe(sub.toJSON()).catch(() => undefined);
}
