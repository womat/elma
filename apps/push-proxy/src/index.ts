import { createPushProxy } from "./proxy.ts";

const port = Number(process.env.PORT ?? 3128);
const server = createPushProxy({ log: (msg) => console.log(`[push-proxy] ${msg}`) });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

server.listen(port, "0.0.0.0", () => console.log(`[push-proxy] lauscht auf Port ${port}`));
