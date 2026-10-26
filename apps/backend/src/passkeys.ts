import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { generateAuthenticationOptions, generateRegistrationOptions } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { PasskeyFinish, PasskeyRegisterStart, type MeDto } from "@elma/shared";
import { newId, newToken } from "./crypto.ts";
import type { Repo, UserRow } from "./repo.ts";
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "./webauthn.ts";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** Upper limit so a flood of requests cannot fill memory. */
const MAX_OPEN_CHALLENGES = 1000;

type Pending =
  | { kind: "login" }
  | { kind: "invite"; inviteCode: string; email: string; userId: string }
  | { kind: "setup"; setupToken: string; userId: string }
  | { kind: "add"; userId: string };

/** Open challenges in memory: short-lived, single-use and limited in number. */
export class ChallengeStore {
  private readonly items = new Map<string, Pending & { challenge: string; expiresAt: number }>();
  private readonly max: number;

  constructor(max = MAX_OPEN_CHALLENGES) {
    this.max = max;
  }

  get size(): number {
    return this.items.size;
  }

  add(challenge: string, pending: Pending, now = Date.now()): string {
    // Map keeps insertion order, so with equal lifetimes also expiry order
    for (const [id, item] of this.items) {
      if (item.expiresAt > now && this.items.size < this.max) break;
      this.items.delete(id); // expired, or the oldest if the list is full
    }
    const id = newToken();
    this.items.set(id, { ...pending, challenge, expiresAt: now + CHALLENGE_TTL_MS });
    return id;
  }

  take(id: string, now = Date.now()): (Pending & { challenge: string }) | undefined {
    const item = this.items.get(id);
    this.items.delete(id);
    return item && item.expiresAt > now ? item : undefined;
  }
}

/** Rough device name for the passkey list, e.g. „iPhone“. */
export function deviceName(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh|Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "Passkey";
}

interface Options {
  repo: Repo;
  /** Public address, e.g. https://elma.example.com – RP ID and expected origin are derived from it */
  publicUrl: string;
  authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  loginResponse: (user: UserRow) => { token: string; user: MeDto };
  rateLimit: { config: { rateLimit: { max: number; timeWindow: string } } };
}

/** Login exclusively with passkeys (WebAuthn). */
export function registerPasskeyRoutes(app: FastifyInstance, { repo, publicUrl, authenticate, loginResponse, rateLimit }: Options): void {
  const { hostname: rpID, origin } = new URL(publicUrl);
  // locally the app also runs via the Vite dev server
  const expectedOrigin = rpID === "localhost" ? [origin, "http://localhost:5173"] : origin;
  const challenges = new ChallengeStore();

  const registrationOptions = (user: { id: string; email: string }) =>
    generateRegistrationOptions({
      rpName: "ELMA",
      rpID,
      userName: user.email,
      userID: new TextEncoder().encode(user.id),
      attestationType: "none",
      excludeCredentials: repo.passkeyDescriptorsOf(user.id) as { id: string; transports?: never[] }[],
      // discoverable credential: login without entering an email
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    });

  /** Verifies the device's response to a registration; null = rejected. */
  const verifyRegistration = async (req: FastifyRequest, challenge: string, response: unknown) => {
    try {
      const result = await verifyRegistrationResponse({
        response: response as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin,
        expectedRPID: rpID,
        requireUserVerification: false,
      });
      return result.verified ? result.registrationInfo.credential : null;
    } catch (err) {
      req.log.warn({ err }, "Passkey-Registrierung abgelehnt");
      return null;
    }
  };

  const savePasskey = (
    req: FastifyRequest,
    userId: string,
    credential: NonNullable<Awaited<ReturnType<typeof verifyRegistration>>>,
  ) =>
    repo.savePasskey({
      id: credential.id,
      userId,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports,
      name: deviceName(req.headers["user-agent"]),
    });

  // ---------- Login ----------

  app.post("/api/auth/passkey/login/options", rateLimit, async () => {
    const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
    return { challengeId: challenges.add(options.challenge, { kind: "login" }), options };
  });

  app.post("/api/auth/passkey/login/verify", rateLimit, async (req, reply) => {
    const body = PasskeyFinish.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Ungültige Anfrage" });
    const pending = challenges.take(body.data.challengeId);
    if (pending?.kind !== "login") return reply.code(400).send({ error: "Anmeldung abgelaufen, bitte nochmal versuchen" });
    const passkey = repo.passkeyById(body.data.response.id);
    const user = passkey && repo.userById(passkey.user_id);
    if (!passkey || !user) return reply.code(401).send({ error: "Dieser Passkey ist nicht (mehr) bei ELMA registriert" });

    let result: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      result = await verifyAuthenticationResponse({
        response: body.data.response as unknown as AuthenticationResponseJSON,
        expectedChallenge: pending.challenge,
        expectedOrigin,
        expectedRPID: rpID,
        credential: { id: passkey.id, publicKey: passkey.public_key, counter: passkey.counter, transports: passkey.transports as never[] },
        requireUserVerification: false,
      });
    } catch (err) {
      req.log.warn({ err }, "Passkey-Anmeldung abgelehnt");
      return reply.code(401).send({ error: "Anmeldung fehlgeschlagen" });
    }
    if (!result.verified) return reply.code(401).send({ error: "Anmeldung fehlgeschlagen" });
    repo.touchPasskey(passkey.id, result.authenticationInfo.newCounter);
    return loginResponse(user);
  });

  // ---------- New passkey: via invite (new account) or setup link ----------

  app.post("/api/auth/passkey/register/options", rateLimit, async (req, reply) => {
    const body = PasskeyRegisterStart.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Ungültige Eingabe" });

    if ("inviteCode" in body.data) {
      const { inviteCode, email } = body.data;
      if (!repo.validInvite(inviteCode)) return reply.code(400).send({ error: "Einladung ungültig oder abgelaufen" });
      if (repo.userByEmail(email)) {
        return reply.code(409).send({ error: "Diese E-Mail hat schon ein Konto – bitte mit Passkey anmelden" });
      }
      const userId = newId();
      const options = await registrationOptions({ id: userId, email });
      return { challengeId: challenges.add(options.challenge, { kind: "invite", inviteCode, email, userId }), options };
    }

    const user = repo.userBySetupToken(body.data.setupToken);
    if (!user) return reply.code(400).send({ error: "Einrichtungslink ungültig oder abgelaufen" });
    const options = await registrationOptions(user);
    return {
      challengeId: challenges.add(options.challenge, { kind: "setup", setupToken: body.data.setupToken, userId: user.id }),
      options,
      email: user.email,
    };
  });

  app.post("/api/auth/passkey/register/verify", rateLimit, async (req, reply) => {
    const body = PasskeyFinish.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Ungültige Anfrage" });
    const pending = challenges.take(body.data.challengeId);
    if (pending?.kind !== "invite" && pending?.kind !== "setup") {
      return reply.code(400).send({ error: "Einrichtung abgelaufen, bitte nochmal versuchen" });
    }

    const credential = await verifyRegistration(req, pending.challenge, body.data.response);
    if (!credential) return reply.code(400).send({ error: "Passkey konnte nicht angelegt werden" });

    if (pending.kind === "invite") {
      // check again: invite or email may have been taken in the meantime
      if (!repo.validInvite(pending.inviteCode)) return reply.code(400).send({ error: "Einladung ungültig oder abgelaufen" });
      if (repo.userByEmail(pending.email)) return reply.code(409).send({ error: "Diese E-Mail hat schon ein Konto" });
      const user = repo.createUser(pending.email, pending.userId);
      savePasskey(req, user.id, credential);
      repo.acceptInvite(pending.inviteCode, user.id);
      // re-read: acceptInvite may have set the name from the invite
      return loginResponse(repo.userById(user.id) ?? user);
    }

    const user = repo.userBySetupToken(pending.setupToken);
    if (!user || user.id !== pending.userId || !repo.useSetupLink(pending.setupToken)) {
      return reply.code(400).send({ error: "Einrichtungslink ungültig oder abgelaufen" });
    }
    savePasskey(req, user.id, credential);
    return loginResponse(user);
  });

  // ---------- Manage own passkeys ----------

  app.get("/api/me/passkeys", { preHandler: authenticate }, async (req) => repo.passkeysOf(req.user.sub));

  app.post("/api/me/passkeys/options", { preHandler: authenticate }, async (req, reply) => {
    const user = repo.userById(req.user.sub);
    if (!user) return reply.code(401).send({ error: "Nicht angemeldet" });
    const options = await registrationOptions(user);
    return { challengeId: challenges.add(options.challenge, { kind: "add", userId: user.id }), options };
  });

  app.post("/api/me/passkeys", { preHandler: authenticate }, async (req, reply) => {
    const body = PasskeyFinish.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Ungültige Anfrage" });
    const pending = challenges.take(body.data.challengeId);
    if (pending?.kind !== "add" || pending.userId !== req.user.sub) {
      return reply.code(400).send({ error: "Einrichtung abgelaufen, bitte nochmal versuchen" });
    }
    const credential = await verifyRegistration(req, pending.challenge, body.data.response);
    if (!credential) return reply.code(400).send({ error: "Passkey konnte nicht angelegt werden" });
    savePasskey(req, req.user.sub, credential);
    return repo.passkeysOf(req.user.sub);
  });

  app.delete<{ Params: { id: string } }>("/api/me/passkeys/:id", { preHandler: authenticate }, async (req, reply) => {
    const own = repo.passkeysOf(req.user.sub);
    if (!own.some((p) => p.id === req.params.id)) return reply.code(404).send({ error: "Nicht gefunden" });
    if (own.length <= 1) return reply.code(400).send({ error: "Der letzte Passkey kann nicht gelöscht werden" });
    repo.deletePasskey(req.params.id, req.user.sub);
    return repo.passkeysOf(req.user.sub);
  });
}
