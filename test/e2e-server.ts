import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dataDir = mkdtempSync(join(tmpdir(), "latent-e2e-"));
process.env.DATA_DIR = dataDir;
process.env.ACCESS_TOKEN = "";
process.env.COMFYUI_URL = "http://127.0.0.1:1";
process.env.AUTO_SHUTDOWN = "0";
process.env.TAILSCALE_MODE ??= "1";
process.env.TAILSCALE_URL ??= "https://studio.example.ts.net";
process.env.TAILSCALE_LOGIN ??= "owner@example.com";

const [{ buildApp }, { db, settings, workflows }] = await Promise.all([
  import("../backend/src/app.ts"),
  import("../backend/src/db.ts"),
]);
const now = new Date().toISOString();
settings.set("onboardedAt", now);
workflows.upsert({
  id: "e2e-pipeline",
  name: "E2E image pipeline",
  type: "image",
  baseGroup: "Image",
  mode: "txt2img",
  order: 0,
  workflow: {
    "1": { class_type: "CLIPTextEncode", inputs: { text: "" } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: "" } },
    "3": { class_type: "EmptyLatentImage", inputs: { width: 1024 } },
  },
  params: [
    { key: "1.text", label: "Positive prompt", nodeId: "1", input: "text", control: "textarea", group: "simple", default: "" },
    { key: "2.text", label: "Negative prompt", nodeId: "2", input: "text", control: "textarea", group: "simple", default: "" },
    { key: "3.width", label: "Width", nodeId: "3", input: "width", control: "number", group: "simple", default: 1024, min: 256, max: 2048, step: 64 },
  ],
  createdAt: now,
  updatedAt: now,
});
const app = await buildApp({ logger: false });
await app.listen({ host: "127.0.0.1", port: 4173 });

async function close(): Promise<void> {
  await app.close();
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
}

process.once("SIGINT", () => void close().finally(() => process.exit(0)));
process.once("SIGTERM", () => void close().finally(() => process.exit(0)));
