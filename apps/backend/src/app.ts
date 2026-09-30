import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { existsSync } from "node:fs";
import { z } from "zod";
import {
  ApplianceSettings,
  Credentials,
  IngestMessage,
  LiveClientMessage,
  PushSubscriptionBody,
  RegisterBody,
  type LiveServerMessage,
  type MeDto,
  type ProducerDto,
} from "@elma/shared";
import { verifyPassword } from "./crypto.ts";
import type { Db } from "./db.ts";
import { LiveHub } from "./hub.ts";
import { loadVapidKeys, PushNotifier, webPushSender, type NotifierOptions, type PushSender } from "./push.ts";
import { Repo } from "./repo.ts";

export interface AppOptions {
  db: Db;
  jwtSecret: string;
  /** Basis-URL für Einladungslinks, z. B. https://elma.example.com */
  publicUrl: string;
  /** Ordner mit dem gebauten PWA-Frontend (optional) */
  webDir?: string;
  logger?: boolean;
  /** Kontakt für Push-Dienste (mailto: oder https:), Pflicht laut Web-Push-Standard */
  vapidSubject?: string;
  /** Für Tests: eigener Sender statt echtem Web-Push */
  pushSender?: PushSender;
  pushOptions?: NotifierOptions;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

const HISTORY_RANGES: Record<string, number> = { "1h": 3_600_000, "24h": 86_400_000, "7d": 604_800_000 };
const JWT_TTL = "30d";

export async function buildApp(
  opts: AppOptions,
): Promise<{ app: FastifyInstance; hub: LiveHub; repo: Repo; notifier: PushNotifier }> {
  const repo = new Repo(opts.db);
  const hub = new LiveHub(repo);
  const vapid = loadVapidKeys(repo);
  const notifier = new PushNotifier(
    repo,
    opts.pushSender ?? webPushSender(vapid, opts.vapidSubject ?? "mailto:elma@example.com"),
    opts.pushOptions,
  );
  hub.subscribe((producerId, reading) => void notifier.onReading(producerId, reading));
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true });

  await app.register(fastifyJwt, { secret: opts.jwtSecret });
  await app.register(fastifyRateLimit, { global: false });
  await app.register(fastifyWebsocket);

  const authenticate = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "Nicht angemeldet" });
    }
  };

  const loginResponse = (user: { id: string; email: string }) => ({
    token: app.jwt.sign({ sub: user.id }, { expiresIn: JWT_TTL }),
    user: { id: user.id, email: user.email } satisfies MeDto,
  });

  const authRateLimit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  // ---------- Auth ----------

  app.post("/api/auth/login", authRateLimit, async (req, reply) => {
    const body = Credentials.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "E-Mail oder Passwort ungültig" });
    const user = repo.userByEmail(body.data.email);
    if (!user || !(await verifyPassword(body.data.password, user.password_hash))) {
      return reply.code(401).send({ error: "E-Mail oder Passwort falsch" });
    }
    return loginResponse(user);
  });

  /** Registrierung nur mit gültiger Einladung – so bleibt die Instanz privat. */
  app.post("/api/auth/register", authRateLimit, async (req, reply) => {
    const body = RegisterBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Ungültige Eingabe" });
    if (!repo.validInvite(body.data.inviteCode)) return reply.code(400).send({ error: "Einladung ungültig oder abgelaufen" });
    if (repo.userByEmail(body.data.email)) return reply.code(409).send({ error: "E-Mail ist bereits registriert, bitte anmelden" });
    const user = await repo.createUser(body.data.email, body.data.password);
    repo.acceptInvite(body.data.inviteCode, user.id);
    return loginResponse(user);
  });

  app.get("/api/me", { preHandler: authenticate }, async (req, reply) => {
    const user = repo.userById(req.user.sub);
    if (!user) return reply.code(401).send({ error: "Nicht angemeldet" });
    return { id: user.id, email: user.email } satisfies MeDto;
  });

  // ---------- Persönliche Geräteauswahl ----------

  app.get("/api/me/appliances", { preHandler: authenticate }, async (req) => {
    return { settings: repo.applianceSettings(req.user.sub) };
  });

  app.put("/api/me/appliances", { preHandler: authenticate }, async (req, reply) => {
    const body = ApplianceSettings.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Ungültige Geräteauswahl" });
    repo.saveApplianceSettings(req.user.sub, body.data);
    return { settings: body.data };
  });

  // ---------- Push-Benachrichtigungen ----------

  app.get("/api/push/key", async () => ({ publicKey: vapid.publicKey }));

  app.post("/api/push/subscribe", { preHandler: authenticate }, async (req, reply) => {
    const body = PushSubscriptionBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Ungültiges Push-Abo" });
    repo.savePushSubscription(req.user.sub, body.data);
    return { ok: true };
  });

  app.post("/api/push/unsubscribe", { preHandler: authenticate }, async (req, reply) => {
    const body = z.object({ endpoint: z.string() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "endpoint fehlt" });
    repo.deletePushSubscription(body.data.endpoint, req.user.sub);
    return { ok: true };
  });

  app.post("/api/push/test", { preHandler: authenticate, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (repo.pushSubscriptions(req.user.sub).length === 0) {
      return reply.code(400).send({ error: "Auf diesem Konto sind noch keine Benachrichtigungen aktiviert" });
    }
    await notifier.sendTest(req.user.sub);
    return { ok: true };
  });

  // ---------- Erzeuger ----------

  app.get("/api/producers", { preHandler: authenticate }, async (req) => {
    return repo.visibleProducers(req.user.sub).map(
      (p): ProducerDto => ({ id: p.id, name: p.name, isOwner: p.owner_id === req.user.sub, current: hub.get(p.id) }),
    );
  });

  app.get<{ Params: { id: string }; Querystring: { range?: string } }>(
    "/api/producers/:id/history",
    { preHandler: authenticate },
    async (req, reply) => {
      if (!repo.canView(req.user.sub, req.params.id)) return reply.code(404).send({ error: "Nicht gefunden" });
      const range = HISTORY_RANGES[req.query.range ?? "24h"] ?? HISTORY_RANGES["24h"]!;
      return repo.history(req.params.id, Date.now() - range);
    },
  );

  app.post<{ Params: { id: string } }>("/api/producers/:id/invites", { preHandler: authenticate }, async (req, reply) => {
    if (!repo.isOwner(req.user.sub, req.params.id)) return reply.code(403).send({ error: "Nur der Erzeuger kann einladen" });
    const invite = repo.createInvite(req.params.id);
    return { ...invite, url: `${opts.publicUrl.replace(/\/$/, "")}/?invite=${invite.code}` };
  });

  app.post<{ Params: { code: string } }>("/api/invites/:code/accept", { preHandler: authenticate }, async (req, reply) => {
    const producerId = repo.acceptInvite(req.params.code, req.user.sub);
    if (!producerId) return reply.code(400).send({ error: "Einladung ungültig oder abgelaufen" });
    return { producerId };
  });

  app.get("/api/health", async () => ({ ok: true }));

  // ---------- WebSocket: Bridge -> Backend ----------

  app.get("/ingest", { websocket: true }, (socket, req) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const producer = token ? repo.producerByDeviceToken(token) : undefined;
    if (!producer) {
      socket.close(4401, "Ungültiges Geräte-Token");
      return;
    }
    req.log.info({ producer: producer.name }, "Bridge verbunden");
    socket.on("message", (raw) => {
      let parsed: z.ZodSafeParseResult<IngestMessage>;
      try {
        parsed = IngestMessage.safeParse(JSON.parse(raw.toString()));
      } catch {
        return;
      }
      if (!parsed.success) {
        socket.send(JSON.stringify({ type: "error", message: "Ungültige Nachricht" }));
        return;
      }
      hub.publish(producer.id, parsed.data.reading);
    });
  });

  // ---------- WebSocket: Backend -> App ----------
  // Erste Nachricht muss {type:"auth", token} sein, damit das JWT nicht in der URL (und damit in Logs) landet.

  app.get("/live", { websocket: true }, (socket) => {
    let unsubscribe: (() => void) | null = null;
    const send = (msg: LiveServerMessage) => socket.send(JSON.stringify(msg));
    const authTimeout = setTimeout(() => socket.close(4401, "Keine Anmeldung"), 10_000);

    socket.on("message", (raw) => {
      if (unsubscribe) return;
      let msg: LiveClientMessage;
      let userId: string;
      try {
        msg = LiveClientMessage.parse(JSON.parse(raw.toString()));
        userId = app.jwt.verify<{ sub: string }>(msg.token).sub;
      } catch {
        send({ type: "error", message: "Anmeldung fehlgeschlagen" });
        socket.close(4401, "Anmeldung fehlgeschlagen");
        return;
      }
      clearTimeout(authTimeout);

      const allowed = new Set(repo.visibleProducers(userId).map((p) => p.id));
      send({ type: "ready", producerIds: [...allowed] });
      for (const id of allowed) {
        const reading = hub.get(id);
        if (reading) send({ type: "reading", producerId: id, reading });
      }
      unsubscribe = hub.subscribe((producerId, reading) => {
        if (allowed.has(producerId)) send({ type: "reading", producerId, reading });
      });
    });

    socket.on("close", () => {
      clearTimeout(authTimeout);
      unsubscribe?.();
    });
  });

  // ---------- PWA ausliefern ----------

  if (opts.webDir && existsSync(opts.webDir)) {
    await app.register(fastifyStatic, { root: opts.webDir, wildcard: false });
    // Single-Page-App: unbekannte Pfade auf index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "Nicht gefunden" });
    });
  }

  return { app, hub, repo, notifier };
}
