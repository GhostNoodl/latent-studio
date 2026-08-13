import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { registerRoutes } from "./routes.ts";
import { registerSecurity } from "./security.ts";

export async function buildApp(options?: {
  logger?: boolean | Record<string, unknown>;
  serveFrontend?: boolean;
}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options?.logger ?? false,
    bodyLimit: 25 * 1024 * 1024,
  });

  await app.register(fastifyWebsocket);
  await registerSecurity(app);

  await app.register(fastifyStatic, {
    root: join(config.dataDir, "outputs"),
    prefix: "/outputs/",
    decorateReply: true,
  });

  const hasFrontend =
    options?.serveFrontend !== false && existsSync(join(config.frontendDist, "index.html"));
  if (hasFrontend) {
    await app.register(fastifyStatic, {
      root: config.frontendDist,
      prefix: "/",
      decorateReply: false,
    });
  }

  await registerRoutes(app);
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api") || req.url.startsWith("/ws") || req.url.startsWith("/outputs")) {
      return reply.code(404).send({ error: "Not found" });
    }
    if (hasFrontend) return reply.sendFile("index.html", config.frontendDist);
    return reply
      .code(404)
      .send({ error: "Frontend not built. Run the Vite dev server (npm run dev:frontend)." });
  });

  return app;
}
