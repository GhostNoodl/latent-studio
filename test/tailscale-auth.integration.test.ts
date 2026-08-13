import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import type { AuthStatus } from "@latent/shared";

const dataDir = mkdtempSync(join(tmpdir(), "latent-tailscale-auth-test-"));
const privateHost = "studio.example.ts.net";
const privateUrl = `https://${privateHost}`;

process.env.DATA_DIR = dataDir;
process.env.ACCESS_TOKEN = "test-pairing-token-with-at-least-24-characters";
process.env.COMFYUI_URL = "http://127.0.0.1:1";
process.env.AUTO_SHUTDOWN = "0";
process.env.TAILSCALE_MODE = "1";
process.env.TAILSCALE_URL = privateUrl;
process.env.TAILSCALE_LOGIN = "owner@example.com";

let app: FastifyInstance;
let db: (typeof import("../backend/src/db.ts"))["db"];

const ownerProxy = {
  remoteAddress: "127.0.0.1",
  headers: {
    host: privateHost,
    origin: privateUrl,
    "tailscale-user-login": "Owner@Example.com",
    "x-forwarded-proto": "https",
  },
} as const;

before(async () => {
  const appModule = await import("../backend/src/app.ts");
  const dbModule = await import("../backend/src/db.ts");
  db = dbModule.db;
  app = await appModule.buildApp({ logger: false, serveFrontend: false });
  await app.ready();
});

after(async () => {
  await app.close();
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test("Tailscale Serve owner is authenticated without a pairing token", async () => {
  const statusResponse = await app.inject({ ...ownerProxy, method: "GET", url: "/api/auth/status" });
  assert.equal(statusResponse.statusCode, 200);
  assert.deepEqual(statusResponse.json<AuthStatus>(), {
    authenticated: true,
    loopback: false,
    method: "tailscale",
    tailscale: { enabled: true, url: privateUrl },
  });

  const protectedResponse = await app.inject({ ...ownerProxy, method: "GET", url: "/api/onboarding" });
  assert.equal(protectedResponse.statusCode, 200);

  const pairingResponse = await app.inject({ ...ownerProxy, method: "GET", url: "/api/auth/pairing" });
  assert.equal(pairingResponse.statusCode, 403);
});

test("identity headers cannot be spoofed through LAN or the wrong hostname", async () => {
  const lanSpoof = await app.inject({
    ...ownerProxy,
    remoteAddress: "192.168.1.44",
    method: "GET",
    url: "/api/onboarding",
  });
  assert.equal(lanSpoof.statusCode, 401);

  const wrongHost = await app.inject({
    remoteAddress: "127.0.0.1",
    method: "GET",
    url: "/api/onboarding",
    headers: {
      host: "other.example.ts.net",
      origin: "https://other.example.ts.net",
      "tailscale-user-login": "owner@example.com",
    },
  });
  assert.equal(wrongHost.statusCode, 401);
});

test("missing or different Tailscale identities stay locked", async () => {
  for (const login of [undefined, "someone-else@example.com"]) {
    const headers: Record<string, string> = { host: privateHost, origin: privateUrl };
    if (login) headers["tailscale-user-login"] = login;
    const response = await app.inject({
      remoteAddress: "127.0.0.1",
      method: "GET",
      url: "/api/onboarding",
      headers,
    });
    assert.equal(response.statusCode, 401);
  }
});

test("direct localhost remains automatic but is reported separately", async () => {
  const response = await app.inject({
    remoteAddress: "127.0.0.1",
    method: "GET",
    url: "/api/auth/status",
    headers: { host: "localhost:4000", origin: "http://localhost:4000" },
  });
  assert.equal(response.statusCode, 200);
  const status = response.json<AuthStatus>();
  assert.equal(status.authenticated, true);
  assert.equal(status.loopback, true);
  assert.equal(status.method, "local");
});
