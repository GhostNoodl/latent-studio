import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import type { GenerationRecord } from "@latent/shared";

const dataDir = mkdtempSync(join(tmpdir(), "latent-backend-test-"));
process.env.DATA_DIR = dataDir;
process.env.ACCESS_TOKEN = "";
process.env.COMFYUI_URL = "http://127.0.0.1:1";
process.env.AUTO_SHUTDOWN = "0";

let app: FastifyInstance;
let db: (typeof import("../backend/src/db.ts"))["db"];
let generations: (typeof import("../backend/src/db.ts"))["generations"];

const remote = {
  remoteAddress: "192.168.1.44",
  headers: { host: "192.168.1.20:4000", origin: "http://192.168.1.20:5173" },
} as const;

before(async () => {
  const appModule = await import("../backend/src/app.ts");
  const dbModule = await import("../backend/src/db.ts");
  db = dbModule.db;
  generations = dbModule.generations;
  app = await appModule.buildApp({ logger: false, serveFrontend: false });
  await app.ready();
});

after(async () => {
  await app.close();
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function pair(): Promise<string> {
  const token = readFileSync(join(dataDir, "access-token"), "utf8").trim();
  const response = await app.inject({
    ...remote,
    method: "POST",
    url: "/api/auth/session",
    payload: { token },
  });
  assert.equal(response.statusCode, 200);
  const cookie = response.headers["set-cookie"];
  assert.equal(typeof cookie, "string");
  return (cookie as string).split(";", 1)[0]!;
}

test("LAN requests require pairing while loopback remains frictionless", async () => {
  const denied = await app.inject({ ...remote, method: "GET", url: "/api/onboarding" });
  assert.equal(denied.statusCode, 401);

  const local = await app.inject({ method: "GET", url: "/api/onboarding" });
  assert.equal(local.statusCode, 200);

  const cookie = await pair();
  const allowed = await app.inject({
    ...remote,
    method: "GET",
    url: "/api/onboarding",
    headers: { ...remote.headers, cookie },
  });
  assert.equal(allowed.statusCode, 200);
});

test("hostile browser origins are rejected before auth routes", async () => {
  const response = await app.inject({
    remoteAddress: remote.remoteAddress,
    method: "GET",
    url: "/api/auth/status",
    headers: { host: "192.168.1.20:4000", origin: "https://evil.example" },
  });
  assert.equal(response.statusCode, 403);

  const wrongPort = await app.inject({
    remoteAddress: remote.remoteAddress,
    method: "GET",
    url: "/api/auth/status",
    headers: { host: "192.168.1.20:4000", origin: "http://192.168.1.20:8888" },
  });
  assert.equal(wrongPort.statusCode, 403);
});

test("generated media is authenticated and arbitrary download endpoint is absent", async () => {
  writeFileSync(join(dataDir, "outputs", "probe.txt"), "private-output");
  const denied = await app.inject({ ...remote, method: "GET", url: "/outputs/probe.txt" });
  assert.equal(denied.statusCode, 401);

  const cookie = await pair();
  const headers = { ...remote.headers, cookie };
  const allowed = await app.inject({ ...remote, headers, method: "GET", url: "/outputs/probe.txt" });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.body, "private-output");

  const removed = await app.inject({
    ...remote,
    headers,
    method: "POST",
    url: "/api/downloads/url",
    payload: { url: "https://example.com/file", folder: "..", filename: "file" },
  });
  assert.equal(removed.statusCode, 404);
});

function record(id: string, createdAt: string): GenerationRecord {
  return {
    id,
    pipelineId: "pipe",
    pipelineName: "Test pipeline",
    pipelineType: "image",
    status: "completed",
    params: { prompt: id },
    outputs: [],
    favorite: false,
    tags: [],
    createdAt,
    completedAt: createdAt,
  };
}

test("generation pages use stable cursors, batch tags, and exact-id ordering", async () => {
  generations.insert(record("gen-a", "2026-01-01T00:00:01.000Z"));
  generations.insert(record("gen-b", "2026-01-01T00:00:02.000Z"));
  generations.insert(record("gen-c", "2026-01-01T00:00:03.000Z"));
  generations.addTag("gen-b", "portrait");

  const first = await app.inject({ method: "GET", url: "/api/generations/page?limit=2" });
  assert.equal(first.statusCode, 200);
  const page1 = first.json<{ items: GenerationRecord[]; nextCursor?: string }>();
  assert.deepEqual(page1.items.map((item) => item.id), ["gen-c", "gen-b"]);
  assert.deepEqual(page1.items[1]?.tags, ["portrait"]);
  assert.ok(page1.nextCursor);

  const second = await app.inject({
    method: "GET",
    url: `/api/generations/page?limit=2&cursor=${encodeURIComponent(page1.nextCursor!)}`,
  });
  assert.deepEqual(second.json<{ items: GenerationRecord[] }>().items.map((item) => item.id), ["gen-a"]);

  const exact = await app.inject({ method: "GET", url: "/api/generations/by-ids?ids=gen-a,gen-c" });
  assert.deepEqual(exact.json<GenerationRecord[]>().map((item) => item.id), ["gen-a", "gen-c"]);
  assert.equal(db.pragma("user_version", { simple: true }), 3);
});
