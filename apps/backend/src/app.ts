import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyRateLimit, { normalizeIP } from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { z } from "zod";
import {
  ApplianceSettings,
  CanReserveBody,
  ControlStatus,
  DisplayNameBody,
  displayNameOf,
  IngestMessage,
  InviteBody,
  LiveClientMessage,
  Throttle,
  PushSubscriptionBody,
  ReservationBody,
  type IngestServerMessage,
  type LiveServerMessage,
  type MeDto,
  type ProducerDto,
  type RecipientDto,
} from "@elma/shared";
import type { Db } from "./db.ts";
import { LiveHub } from "./hub.ts";
import { registerPasskeyRoutes } from "./passkeys.ts";
import { loadVapidKeys, PushNotifier, webPushSender, type NotifierOptions, type PushSender } from "./push.ts";
import { Repo, type UserRow } from "./repo.ts";
import { ReservationError, ReservationService } from "./reservations.ts";
import { parseShellyFrame } from "./shelly.ts";

export interface AppOptions {
  db: Db;
  jwtSecret: string;
  /** Base URL for invite links, e.g. https://elma.example.com */
  publicUrl: string;
  /** Directory with the built PWA frontend (optional) */
  webDir?: string;
  logger?: boolean;
  /** Contact for push services (mailto: or https:), required by the Web Push standard */
  vapidSubject?: string;
  /** Outbound proxy for Web Push, e.g. http://push-proxy:3128 (without: direct) */
  pushProxy?: string;
  /** For tests: own sender instead of real Web Push */
  pushSender?: PushSender;
  pushOptions?: NotifierOptions;
  /** Smoothing window for displayed values; 0 = unsmoothed */
  smoothWindowMs?: number;
  /** Displayed version (from the build), e.g. v0.2.0 */
  version?: string;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

const HISTORY_RANGES: Record<string, number> = { "1h": 3_600_000, "24h": 86_400_000, "7d": 604_800_000 };
const JWT_TTL = "30d";
/** Throttle for Shelly values, as in the bridge: immediately on a change of 50 W, otherwise at most every 5 s */
const SHELLY_MIN_INTERVAL_MS = 5000;
const SHELLY_DELTA_WATTS = 50;

/**
 * Real address of the client. Behind the Cloudflare Tunnel it is in CF-Connecting-IP; Cloudflare sets that header
 * itself, overwriting one sent by the client. X-Forwarded-For, in contrast, the client can prefix with made-up values.
 */
export function clientIp(req: FastifyRequest): string {
  const cf = req.headers["cf-connecting-ip"];
  return typeof cf === "string" && isIP(cf) ? cf : req.ip;
}

/** The Shelly carries its device token in the path – it must not end up in the log. */
export function redactUrl(url: string): string {
  return url.replace(/^(\/ingest\/shelly\/)[^/?#]+/, "$1***");
}

export async function buildApp(
  opts: AppOptions,
): Promise<{ app: FastifyInstance; hub: LiveHub; repo: Repo; notifier: PushNotifier; reservations: ReservationService }> {
  const repo = new Repo(opts.db);
  const hub = new LiveHub(repo, opts.smoothWindowMs);
  const vapid = loadVapidKeys(repo);
  const notifier = new PushNotifier(
    repo,
    opts.pushSender ?? webPushSender(vapid, opts.vapidSubject ?? "mailto:elma@example.com", opts.pushProxy),
    opts.pushOptions,
  );
  hub.subscribe((producerId, reading) => void notifier.onReading(producerId, reading));
  const reservations = new ReservationService(repo, notifier);
  reservations.start();
  const app = Fastify({
    logger: opts.logger
      ? {
          serializers: {
            req: (req: FastifyRequest) => ({
              method: req.method,
              url: redactUrl(req.url),
              host: req.host,
              remoteAddress: clientIp(req),
            }),
          },
        }
      : false,
    // trust only proxies in the own network (cloudflared in the Docker network), not every entry in X-Forwarded-For
    trustProxy: "loopback, linklocal, uniquelocal",
  });

  await app.register(fastifyJwt, { secret: opts.jwtSecret });
  // normalizeIP collapses IPv6 to the /64, as the plugin does without a custom keyGenerator; a connection usually has
  // a whole /64, otherwise each of its addresses would get its own quota
  await app.register(fastifyRateLimit, { global: false, keyGenerator: (req) => normalizeIP(clientIp(req)) });
  await app.register(fastifyWebsocket);
  app.addHook("onClose", async () => reservations.stop());

  const authenticate = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "Nicht angemeldet" });
    }
  };

  const meDto = (user: UserRow): MeDto => ({ id: user.id, email: user.email, displayName: user.displayName });

  const loginResponse = (user: UserRow) => ({
    token: app.jwt.sign({ sub: user.id }, { expiresIn: JWT_TTL }),
    user: meDto(user),
  });

  const authRateLimit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  // ---------- Auth ----------

  // Login only with passkey; new accounts only with a valid invite – this keeps the instance private.
  registerPasskeyRoutes(app, { repo, publicUrl: opts.publicUrl, authenticate, loginResponse, rateLimit: authRateLimit });

  app.get("/api/me", { preHandler: authenticate }, async (req, reply) => {
    const user = repo.userById(req.user.sub);
    if (!user) return reply.code(401).send({ error: "Nicht angemeldet" });
    return meDto(user);
  });

  app.put("/api/me", { preHandler: authenticate }, async (req, reply) => {
    const body = DisplayNameBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Ungültiger Name" });
    repo.setDisplayName(req.user.sub, body.data.displayName);
    const user = repo.userById(req.user.sub);
    if (!user) return reply.code(401).send({ error: "Nicht angemeldet" });
    return meDto(user);
  });

  // ---------- Personal appliance selection ----------

  app.get("/api/me/appliances", { preHandler: authenticate }, async (req) => {
    return { settings: repo.applianceSettings(req.user.sub) };
  });

  app.put("/api/me/appliances", { preHandler: authenticate }, async (req, reply) => {
    const body = ApplianceSettings.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Ungültige Geräteauswahl" });
    repo.saveApplianceSettings(req.user.sub, body.data);
    return { settings: body.data };
  });

  // ---------- Push notifications ----------

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

  // ---------- Producers ----------

  const ownerName = (ownerId: string) => {
    const owner = repo.userById(ownerId);
    return owner ? displayNameOf(owner) : "Erzeuger";
  };

  app.get("/api/producers", { preHandler: authenticate }, async (req) => {
    return repo.visibleProducers(req.user.sub).map(
      (p): ProducerDto => ({
        id: p.id,
        name: p.name,
        ownerName: ownerName(p.owner_id),
        isOwner: p.owner_id === req.user.sub,
        current: hub.get(p.id),
        reservation: reservations.stateFor(p.id, req.user.sub),
      }),
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

  app.patch<{ Params: { id: string } }>("/api/producers/:id", { preHandler: authenticate }, async (req, reply) => {
    if (!repo.canView(req.user.sub, req.params.id)) return reply.code(404).send({ error: "Nicht gefunden" });
    if (!repo.isOwner(req.user.sub, req.params.id)) return reply.code(403).send({ error: "Nur der Erzeuger kann umbenennen" });
    const body = z.object({ name: z.string().trim().min(1, "Name darf nicht leer sein").max(60) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Ungültiger Name" });
    repo.renameProducer(req.params.id, body.data.name);
    return { id: req.params.id, name: body.data.name };
  });

  app.post<{ Params: { id: string } }>("/api/producers/:id/invites", { preHandler: authenticate }, async (req, reply) => {
    if (!repo.isOwner(req.user.sub, req.params.id)) return reply.code(403).send({ error: "Nur der Erzeuger kann einladen" });
    const body = InviteBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Ungültiger Name" });
    const invite = repo.createInvite(req.params.id, body.data.displayName ?? null);
    return { ...invite, url: `${opts.publicUrl.replace(/\/$/, "")}/?invite=${invite.code}` };
  });

  app.post<{ Params: { code: string } }>("/api/invites/:code/accept", { preHandler: authenticate }, async (req, reply) => {
    // If the producer opens their own link (or a recipient a second one), the invite would otherwise be used up,
    // and the producer would be listed as a recipient of themselves, with the name from the invite
    const invite = repo.validInvite(req.params.code);
    if (invite && repo.canView(req.user.sub, invite.producer_id)) return reply.code(409).send({ error: "Du siehst diesen Erzeuger schon" });
    const producerId = repo.acceptInvite(req.params.code, req.user.sub);
    if (!producerId) return reply.code(400).send({ error: "Einladung ungültig oder abgelaufen" });
    return { producerId };
  });

  // ---------- Reservation (ELISA mode, docs/elisa.md) ----------

  const reservationReply = (reply: FastifyReply, err: unknown) => {
    if (err instanceof ReservationError) return reply.code(err.status).send({ error: err.message });
    throw err;
  };

  app.post<{ Params: { id: string } }>(
    "/api/producers/:id/reservation",
    { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!repo.canView(req.user.sub, req.params.id)) return reply.code(404).send({ error: "Nicht gefunden" });
      const body = ReservationBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Ungültige Dauer" });
      try {
        reservations.reserve(req.params.id, req.user.sub, body.data.minutes, body.data.startsAt);
      } catch (err) {
        return reservationReply(reply, err);
      }
      return reservations.stateFor(req.params.id, req.user.sub);
    },
  );

  app.delete<{ Params: { id: string } }>("/api/producers/:id/reservation", { preHandler: authenticate }, async (req, reply) => {
    if (!repo.canView(req.user.sub, req.params.id)) return reply.code(404).send({ error: "Nicht gefunden" });
    try {
      reservations.end(req.params.id, req.user.sub);
    } catch (err) {
      return reservationReply(reply, err);
    }
    return reservations.stateFor(req.params.id, req.user.sub);
  });

  app.delete<{ Params: { id: string } }>("/api/producers/:id/reservation/planned", { preHandler: authenticate }, async (req, reply) => {
    if (!repo.canView(req.user.sub, req.params.id)) return reply.code(404).send({ error: "Nicht gefunden" });
    try {
      reservations.cancelPlanned(req.params.id, req.user.sub);
    } catch (err) {
      return reservationReply(reply, err);
    }
    return reservations.stateFor(req.params.id, req.user.sub);
  });

  app.get<{ Params: { id: string } }>("/api/producers/:id/recipients", { preHandler: authenticate }, async (req, reply) => {
    if (!repo.isOwner(req.user.sub, req.params.id)) return reply.code(403).send({ error: "Nur der Erzeuger sieht die Empfänger" });
    return repo
      .recipientsOf(req.params.id)
      .map((r): RecipientDto => ({ userId: r.id, name: displayNameOf(r), email: r.email, canReserve: r.canReserve }));
  });

  app.put<{ Params: { id: string; userId: string } }>(
    "/api/producers/:id/recipients/:userId",
    { preHandler: authenticate },
    async (req, reply) => {
      if (!repo.isOwner(req.user.sub, req.params.id)) return reply.code(403).send({ error: "Nur der Erzeuger vergibt das Recht" });
      const body = CanReserveBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "canReserve fehlt" });
      try {
        reservations.setCanReserve(req.params.id, req.params.userId, body.data.canReserve);
      } catch (err) {
        return reservationReply(reply, err);
      }
      return { userId: req.params.userId, canReserve: body.data.canReserve };
    },
  );

  // Node-RED polls from inside out (via the Cloudflare tunnel) instead of ELMA switching into the LAN: the backend
  // cannot reach the LAN, and in myhome no incoming MQTT message switches anything. Separate token so it cannot
  // feed in readings; the bridge's device token is not valid here.
  app.post("/api/control/status", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const producer = token ? repo.controlTokenProducer(token) : undefined;
    if (!producer) return reply.code(401).send({ error: "Ungültiges Steuer-Token" });
    const body = ControlStatus.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Ungültiger Status" });
    repo.touchControlToken(token);
    return reservations.reportStatus(producer.id, body.data);
  });

  app.get("/api/health", async () => ({ ok: true, version: opts.version ?? "dev" }));

  // ---------- WebSocket: Bridge -> Backend ----------

  app.get("/ingest", { websocket: true }, (socket, req) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const producer = token ? repo.producerByDeviceToken(token) : undefined;
    if (!producer) {
      socket.close(4401, "Ungültiges Geräte-Token");
      return;
    }
    req.log.info({ producer: producer.name }, "Bridge verbunden");

    // Reservation for MAGGIE (display only). The service also reports Node-RED status changes that don't concern the
    // bridge; so only what changed compared to the last message is sent.
    let lastReservation = "";
    const sendReservation = () => {
      const { until, by } = reservations.current(producer.id);
      const msg: IngestServerMessage = by ? { type: "reservation", until, by } : { type: "reservation", until };
      const json = JSON.stringify(msg);
      if (json === lastReservation) return;
      lastReservation = json;
      socket.send(json);
    };
    sendReservation();
    const offReservations = reservations.subscribe((producerId) => {
      if (producerId === producer.id) sendReservation();
    });
    socket.on("close", offReservations);

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
      if (parsed.data.type === "battery") hub.publishBattery(producer.id, parsed.data.battery);
      else hub.publish(producer.id, parsed.data.reading);
    });
  });

  // Shelly Gen2+ (outbound WebSocket) cannot set an Authorization header, hence the token in the path.
  app.get<{ Params: { token: string } }>("/ingest/shelly/:token", { websocket: true }, (socket, req) => {
    const producer = repo.producerByDeviceToken(req.params.token);
    if (!producer) {
      socket.close(4401, "Ungültiges Geräte-Token");
      return;
    }
    req.log.info({ producer: producer.name }, "Shelly verbunden");
    const throttle = new Throttle(SHELLY_MIN_INTERVAL_MS, SHELLY_DELTA_WATTS);
    socket.on("message", (raw) => {
      const watts = parseShellyFrame(raw.toString());
      if (watts === null) return;
      const now = Date.now();
      if (!throttle.shouldSend(watts, now)) return;
      throttle.markSent(watts, now);
      hub.publish(producer.id, { watts, timestamp: now });
    });
  });

  // ---------- WebSocket: Backend -> App ----------
  // First message must be {type:"auth", token} so the JWT doesn't end up in the URL (and thus in logs).

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
      const sendReservation = (producerId: string) =>
        send({ type: "reservation", producerId, state: reservations.stateFor(producerId, userId) });
      send({ type: "ready", producerIds: [...allowed] });
      for (const id of allowed) {
        const reading = hub.get(id);
        if (reading) send({ type: "reading", producerId: id, reading });
        sendReservation(id);
      }
      const offReadings = hub.subscribe((producerId, reading) => {
        if (allowed.has(producerId)) send({ type: "reading", producerId, reading });
      });
      const offReservations = reservations.subscribe((producerId) => {
        if (allowed.has(producerId)) sendReservation(producerId);
      });
      unsubscribe = () => {
        offReadings();
        offReservations();
      };
    });

    socket.on("close", () => {
      clearTimeout(authTimeout);
      unsubscribe?.();
    });
  });

  // ---------- Serve PWA ----------

  if (opts.webDir && existsSync(opts.webDir)) {
    await app.register(fastifyStatic, { root: opts.webDir, wildcard: false });
    // Single-page app: unknown paths go to index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "Nicht gefunden" });
    });
  }

  return { app, hub, repo, notifier, reservations };
}
