import { browserSupportsWebAuthn, startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import type { PasskeyDto, PasskeyRegisterStart } from "@elma/shared";
import { api, type AuthResponse } from "./api.ts";

export const passkeysSupported = browserSupportsWebAuthn();

/** Fehler, der beim User als Hinweis statt als roter Fehler erscheint (z. B. Abbruch). */
export class PasskeyCancelled extends Error {}

/** Übersetzt Browser-Fehler in verständliche Meldungen. */
function explain(err: unknown): Error {
  if (err instanceof WebAuthnError) {
    if (err.code === "ERROR_CEREMONY_ABORTED") return new PasskeyCancelled("Abgebrochen");
    if (err.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") return new Error("Auf diesem Gerät gibt es schon einen Passkey für dich");
  }
  // NotAllowedError: abgebrochen, Zeit abgelaufen oder kein passender Passkey ausgewählt
  if (err instanceof Error && (err.name === "NotAllowedError" || err.name === "AbortError")) {
    return new PasskeyCancelled("Abgebrochen oder kein Passkey ausgewählt");
  }
  return err instanceof Error ? err : new Error(String(err));
}

async function withDevice<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw explain(err);
  }
}

export function signInWithPasskey(): Promise<AuthResponse> {
  return withDevice(async () => {
    const { challengeId, options } = await api.passkeyLoginOptions();
    return api.passkeyLogin(challengeId, await startAuthentication({ optionsJSON: options }));
  });
}

/** Neues Konto per Einladung oder neuer Passkey per Einrichtungslink. */
export function registerPasskey(start: PasskeyRegisterStart): Promise<AuthResponse> {
  return withDevice(async () => {
    const { challengeId, options } = await api.passkeyRegisterOptions(start);
    return api.passkeyRegister(challengeId, await startRegistration({ optionsJSON: options }));
  });
}

/** Weiteren Passkey für das angemeldete Konto anlegen. */
export function addPasskey(): Promise<PasskeyDto[]> {
  return withDevice(async () => {
    const { challengeId, options } = await api.addPasskeyOptions();
    return api.addPasskey(challengeId, await startRegistration({ optionsJSON: options }));
  });
}
