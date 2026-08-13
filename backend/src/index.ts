import { config } from "./config.ts";
import { comfy } from "./comfy.ts";
import { bridge } from "./ws-bridge.ts";
import { comfySupervisor } from "./comfy-supervisor.ts";
import { captureConsole } from "./logs.ts";
import { installAutoShutdown, shutdown } from "./lifecycle.ts";
import { seedDefaultPipelines, seedWildcards } from "./seed.ts";
import { ensureRegionBlank } from "./region-blank.ts";
import { workflows } from "./db.ts";
import { getPairingTokenPath } from "./security.ts";
import { catalog } from "./models-catalog.ts";
import { buildApp } from "./app.ts";

// Tee our own stdout/stderr into the in-app log console before anything logs.
captureConsole();

const app = await buildApp({ logger: { transport: { target: "pino-pretty" } } });

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
  catalog.warm();
  app.log.info(`Latent backend on http://${config.host}:${config.port} → ComfyUI ${config.comfyUrl}`);
  if (config.host !== "127.0.0.1" && config.host !== "localhost" && config.host !== "::1") {
    app.log.info(`LAN pairing token: ${getPairingTokenPath()}`);
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
