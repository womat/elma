import type {
  ApplianceSettings,
  HistoryPoint,
  MeDto,
  PasskeyDto,
  PasskeyRegisterStart,
  ProducerDto,
  RecipientDto,
  ReservationStateDto,
} from "@elma/shared";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";

const TOKEN_KEY = "elma.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // z. B. privater Modus – dann nur für diese Sitzung angemeldet
  }
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Fehler ${res.status}`);
  return body as T;
}

export interface AuthResponse {
  token: string;
  user: MeDto;
}

interface Challenge<T> {
  challengeId: string;
  options: T;
}

const post = <T>(path: string, body: unknown = {}) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  passkeyLoginOptions: () => post<Challenge<PublicKeyCredentialRequestOptionsJSON>>("/api/auth/passkey/login/options"),
  passkeyLogin: (challengeId: string, response: AuthenticationResponseJSON) =>
    post<AuthResponse>("/api/auth/passkey/login/verify", { challengeId, response }),
  passkeyRegisterOptions: (start: PasskeyRegisterStart) =>
    post<Challenge<PublicKeyCredentialCreationOptionsJSON> & { email?: string }>("/api/auth/passkey/register/options", start),
  passkeyRegister: (challengeId: string, response: RegistrationResponseJSON) =>
    post<AuthResponse>("/api/auth/passkey/register/verify", { challengeId, response }),
  myPasskeys: () => request<PasskeyDto[]>("/api/me/passkeys"),
  addPasskeyOptions: () => post<Challenge<PublicKeyCredentialCreationOptionsJSON>>("/api/me/passkeys/options"),
  addPasskey: (challengeId: string, response: RegistrationResponseJSON) => post<PasskeyDto[]>("/api/me/passkeys", { challengeId, response }),
  deletePasskey: (id: string) => request<PasskeyDto[]>(`/api/me/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" }),
  me: () => request<MeDto>("/api/me"),
  setDisplayName: (displayName: string | null) => request<MeDto>("/api/me", { method: "PUT", body: JSON.stringify({ displayName }) }),
  producers: () => request<ProducerDto[]>("/api/producers"),
  renameProducer: (id: string, name: string) =>
    request<{ id: string; name: string }>(`/api/producers/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  health: () => request<{ ok: boolean; version: string }>("/api/health"),
  history: (id: string, range = "24h") => request<HistoryPoint[]>(`/api/producers/${id}/history?range=${range}`),
  createInvite: (id: string, displayName?: string) =>
    post<{ code: string; url: string; expiresAt: number }>(`/api/producers/${id}/invites`, displayName ? { displayName } : {}),
  appliances: () => request<{ settings: ApplianceSettings | null }>("/api/me/appliances"),
  saveAppliances: (settings: ApplianceSettings) =>
    request<{ settings: ApplianceSettings }>("/api/me/appliances", { method: "PUT", body: JSON.stringify(settings) }),
  pushKey: () => request<{ publicKey: string }>("/api/push/key"),
  pushSubscribe: (sub: PushSubscriptionJSON) => request<{ ok: true }>("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub) }),
  pushUnsubscribe: (endpoint: string) =>
    request<{ ok: true }>("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint }) }),
  pushTest: () => request<{ ok: true }>("/api/push/test", { method: "POST" }),
  reserve: (id: string, minutes: number, startsAt?: number) =>
    post<ReservationStateDto>(`/api/producers/${id}/reservation`, { minutes, startsAt }),
  endReservation: (id: string) => request<ReservationStateDto>(`/api/producers/${id}/reservation`, { method: "DELETE" }),
  cancelPlanned: (id: string) => request<ReservationStateDto>(`/api/producers/${id}/reservation/planned`, { method: "DELETE" }),
  recipients: (id: string) => request<RecipientDto[]>(`/api/producers/${id}/recipients`),
  setCanReserve: (id: string, userId: string, canReserve: boolean) =>
    request<{ userId: string; canReserve: boolean }>(`/api/producers/${id}/recipients/${userId}`, {
      method: "PUT",
      body: JSON.stringify({ canReserve }),
    }),
  acceptInvite: (code: string) => request<{ producerId: string }>(`/api/invites/${code}/accept`, { method: "POST" }),
};
