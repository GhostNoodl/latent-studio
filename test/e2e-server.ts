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

const [{ buildApp }, { db, generations, settings, workflows }] = await Promise.all([
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
workflows.upsert({
  id: "e2e-music",
  name: "MiniMax Music 3 — text to music",
  type: "audio",
  baseGroup: "MiniMax Music 3",
  mode: "t2m",
  order: 0,
  workflow: {
    "1": {
      class_type: "MiniMaxMusic3TextEncode",
      inputs: { caption: "", lyrics: "", max_duration: 60 },
    },
  },
  params: [
    { key: "1.caption", label: "Caption", nodeId: "1", input: "caption", control: "textarea", group: "simple", default: "" },
    { key: "1.lyrics", label: "Lyrics", nodeId: "1", input: "lyrics", control: "textarea", group: "simple", default: "" },
    { key: "1.max_duration", label: "Max Duration", nodeId: "1", input: "max_duration", control: "slider", group: "simple", default: 60, min: 1, max: 300, step: 1 },
  ],
  createdAt: now,
  updatedAt: now,
});
generations.insert({
  id: "e2e-song",
  pipelineId: "e2e-music",
  pipelineName: "MiniMax Music 3 — text to music",
  pipelineType: "audio",
  status: "completed",
  seed: 7,
  params: { "1.caption": "Global Metadata: synth-pop", "1.lyrics": "[Chorus]\nStay awake" },
  outputs: [
    {
      url: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=",
      type: "audio",
      filename: "music3-mobile-smoke.wav",
    },
  ],
  favorite: false,
  tags: [],
  createdAt: now,
  completedAt: now,
});
const imageOutput = {
  url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  type: "image" as const,
  filename: "reuse-source.png",
};
generations.insert({
  id: "e2e-reuse-source",
  pipelineId: "e2e-pipeline",
  pipelineName: "E2E image pipeline",
  pipelineType: "image",
  status: "completed",
  seed: 42,
  params: { "1.text": "recovered original prompt", "2.text": "blurry", "3.width": 768 },
  outputs: [imageOutput],
  favorite: false,
  tags: [],
  createdAt: new Date(Date.now() - 2_000).toISOString(),
  completedAt: new Date(Date.now() - 2_000).toISOString(),
});
generations.insert({
  id: "e2e-reuse-upscale",
  pipelineId: "e2e-pipeline",
  pipelineName: "Upscale · 4x Remacri",
  pipelineType: "image",
  status: "completed",
  params: { source: "e2e-reuse-source", upscaler: "4x-remacri.pth" },
  outputs: [{ ...imageOutput, filename: "reuse-upscaled.png" }],
  favorite: false,
  tags: [],
  createdAt: new Date(Date.now() - 1_000).toISOString(),
  completedAt: new Date(Date.now() - 1_000).toISOString(),
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
