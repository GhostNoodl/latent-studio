import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { comfy } from "./comfy.ts";
import { bridge } from "./ws-bridge.ts";
import { comfySupervisor } from "./comfy-supervisor.ts";
import { captureConsole } from "./logs.ts";
import { installAutoShutdown, shutdown } from "./lifecycle.ts";
import { seedDefaultPipelines, seedWildcards } from "./seed.ts";
import { ensureRegionBlank } from "./region-blank.ts";
import { workflows } from "./db.ts";
import { registerRoutes } from "./routes.ts";

// Tee our own stdout/stderr into the in-app log console before anything logs.
captureConsole();

const app = Fastify({
  logger: { transport: { target: "pino-pretty" } },
  bodyLimit: 25 * 1024 * 1024, // allow base64 image uploads
});

await app.register(fastifyCors, { origin: true });
await app.register(fastifyWebsocket);

// App-owned outputs store (images + videos, with range-request support).
await app.register(fastifyStatic, {
  root: join(config.dataDir, "outputs"),
  prefix: "/outputs/",
  decorateReply: true,
});

// Static SPA in production builds.
const hasFrontend = existsSync(join(config.frontendDist, "index.html"));
if (hasFrontend) {
  // wildcard:true serves files dynamically from disk (survives rebuilds with
  // new hashed asset names). Missing paths fall through to the SPA fallback
  // below via Fastify's not-found handler.
  await app.register(fastifyStatic, {
    root: config.frontendDist,
    prefix: "/",
    decorateReply: false,
  });
}

await registerRoutes(app);

// SPA fallback (client-side routing) — only for non-API, non-WS paths.
app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith("/api") || req.url.startsWith("/ws") || req.url.startsWith("/outputs")) {
    return reply.code(404).send({ error: "Not found" });
  }
  if (hasFrontend) return reply.sendFile("index.html", config.frontendDist);
  return reply
    .code(404)
    .send({ error: "Frontend not built. Run the Vite dev server (npm run dev:frontend)." });
});

// Install the bundled starter wildcards on first run (no-op if any already exist).
seedWildcards();

// Own ComfyUI (hidden window + captured logs) unless it's already running.
void comfySupervisor.start();

// Stop Latent + ComfyUI when the last browser tab closes, and on process signals.
installAutoShutdown();
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Warm up + connect upstream WebSocket.
bridge.connect();
comfy
  .objectInfo()
  .then(() => app.log.info("object_info cached from ComfyUI"))
  .catch((err) => app.log.warn(`object_info unavailable: ${err.message}`));

// Best-effort first-run seeding: once ComfyUI is reachable, import the bundled
// default pipelines if none exist (the onboarding wizard also triggers this).
void (async () => {
  for (let i = 0; i < 60; i++) {
    const blankOk = await ensureRegionBlank(); // shared no-op mask for empty regions
    const seeded = await seedDefaultPipelines().then((n) => n > 0).catch(() => false);
    if (blankOk && (seeded || workflows.list().length > 0)) return;
    await new Promise((r) => setTimeout(r, 5000));
  }
})();

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Latent backend on http://${config.host}:${config.port} → ComfyUI ${config.comfyUrl}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
