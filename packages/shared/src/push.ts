/**
 * The browsers' push services. These are the only hosts the backend may reach for web push:
 * push subscriptions with any other address are rejected, and the push proxy only allows connections to them.
 */
export const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com", // Chrome, Android
  "push.apple.com", // Safari, iPhone (web.push.apple.com)
  "push.services.mozilla.com", // Firefox
  "notify.windows.com", // Edge
] as const;

/** true if the host is a push service (exactly or as a subdomain); never IP addresses. */
export function isPushHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!h || /^[\d.]+$/.test(h) || h.includes(":")) return false;
  return PUSH_HOST_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}
