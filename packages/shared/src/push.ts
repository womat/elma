/**
 * Push-Dienste der Browser. Nur diese Hosts darf das Backend für Web-Push erreichen:
 * Push-Abos mit anderer Adresse werden abgelehnt, und der Push-Proxy lässt nur Verbindungen dorthin zu.
 */
export const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com", // Chrome, Android
  "push.apple.com", // Safari, iPhone (web.push.apple.com)
  "push.services.mozilla.com", // Firefox
  "notify.windows.com", // Edge
] as const;

/** true, wenn der Host ein Push-Dienst ist (genau oder als Subdomain); IP-Adressen nie. */
export function isPushHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!h || /^[\d.]+$/.test(h) || h.includes(":")) return false;
  return PUSH_HOST_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}
