/**
 * Verification of passkey responses. Separate module so tests can replace the cryptographic check
 * (real signatures only exist with a real device).
 */
export { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
