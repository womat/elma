import { createHash, randomBytes, randomUUID } from "node:crypto";

/** Geräte-Tokens werden nur als SHA-256 gespeichert. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function newInviteCode(): string {
  return randomBytes(9).toString("base64url");
}

export const newId = randomUUID;
