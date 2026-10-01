/**
 * Prüfung der Passkey-Antworten. Eigenes Modul, damit Tests die kryptografische Prüfung
 * ersetzen können (echte Signaturen gibt es nur mit einem echten Gerät).
 */
export { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
