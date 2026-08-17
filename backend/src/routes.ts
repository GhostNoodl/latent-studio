import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname } from "node:path";
import { config } from "./config.ts";
import { comfy } from "./comfy.ts";
import { generations, workflows, modelMeta, presets, collections, modelFolders, settings, hiddenModels } from "./db.ts";
import { bridge } from "./ws-bridge.ts";
import {
  runGeneration,
  runUpscale,
  runEnhance,
  resolveGenerationReuse,
  getEnhanceFactor,
  setEnhanceFactor,
  outputToComfyInput,
} from "./generate.ts";
import { comfyEnv, writeExtraModelPaths } from "./comfy-env.ts";
import {
  getCustomModelPaths,
  setCustomModelPaths,
  validateModelPath,
  detectModelDirs,
  listDirectories,
} from "./model-paths.ts";
import { buildManifestParams } from "./manifest-builder.ts";
import { pipelineRequirements } from "./pipeline-requirements.ts";
import { catalog } from "./models-catalog.ts";
import { enrichFromCivitai, civitaiQuery, searchCivitai, getCivitaiModel } from "./civitai.ts";
import { downloads } from "./downloads.ts";
import { starterModelById, starterModelsWithState } from "./starter-models.ts";
import { seedDefaultPipelines } from "./seed.ts";
import { runAutoMask } from "./automask.ts";
import { runCnPreview } from "./cn-preview.ts";
import { logs } from "./logs.ts";
import { comfySupervisor } from "./comfy-supervisor.ts";
import { getVramMode, setVramMode } from "./comfy-perf.ts";
import { shutdown } from "./lifecycle.ts";
import { updateStatus } from "./update.ts";
import { searchTags } from "./tags.ts";
import { listWildcards, readWildcard, writeWildcard, deleteWildcard } from "./wildcards.ts";
import { getLlmConfig, setLlmConfig, chat, chatStream } from "./llm.ts";
import { withSystem, type PromptSeed } from "./prompt-assistant.ts";
import { nanoid } from "nanoid";
import type {
  ChatMessage,
  HealthStatus,
  LlmConfigInput,
  ModelKind,
  OnboardingStatus,
  Preset,
  PresetKind,
  QueueItem,
  QueueSnapshot,
  ServerEvent,
  WorkflowManifest,
} from "@latent/shared";

const generateSchema = z.object({
  pipelineId: z.string().min(1).max(128),
  values: z.record(z.string(), z.any()),
  rawWorkflow: z.record(z.string(), z.any()).optional(),
  seedMode: z.enum(["fixed", "random", "increment"]).optional(),
  batch: z.number().int().min(1).max(64).optional(),
  runs: z.array(z.record(z.string(), z.any())).max(256).optional(),
}).strict();

const uploadSchema = z.object({
  filename: z.string().min(1).max(255).refine((value) => value === basename(value) && !value.includes("\0"), "Invalid filename"),
  dataBase64: z.string().min(1),
  contentType: z.string().max(128).regex(/^image\//).optional(),
}).strict();

const MODEL_KIND_VALUES = [
  "checkpoint",
  "diffusion",
  "text_encoder",
  "lora",
  "vae",
  "upscale",
  "controlnet",
  "embedding",
] as const;
const modelKindSchema = z.enum(MODEL_KIND_VALUES);
const modelFileSchema = z.object({
  kind: modelKindSchema,
  file: z.string().min(1).max(2048).refine((value) => !value.includes("\0")),
  hidden: z.boolean().optional(),
}).strict();
const downloadSchema = z.object({
  modelId: z.number().int().positive(),
  versionId: z.number().int().positive(),
}).strict();
const idsSchema = z.object({
  ids: z.array(z.string().min(1).max(128)).min(1).max(256),
}).strict();

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // ── First-run ComfyUI setup ──────────────────────────────────────────────────
  app.get("/api/setup/status", async () => comfyEnv.status());

  app.post("/api/setup/bootstrap", async (req) => {
    const { force } = (req.body ?? {}) as { force?: boolean };
    void comfyEnv.bootstrap(force === true); // runs in the background, streams progress over WS
    return { ok: true };
  });

  app.post("/api/setup/launch", async () => ({ ok: true, launched: comfyEnv.launch() }));

  // Import the bundled default pipelines (no-op if pipelines already exist). Needs ComfyUI up.
  app.post("/api/setup/seed-pipelines", async () => ({ seeded: await seedDefaultPipelines() }));

  // ── First-run onboarding ─────────────────────────────────────────────────────
  app.get("/api/onboarding", async (): Promise<OnboardingStatus> => ({
    onboardedAt: settings.get("onboardedAt") ?? null,
  }));
  app.post("/api/onboarding/complete", async () => {
    settings.set("onboardedAt", new Date().toISOString());
    return { ok: true };
  });
  app.post("/api/onboarding/reset", async () => {
    settings.set("onboardedAt", ""); // empty value deletes the key
    return { ok: true };
  });

  // Curated starter models for onboarding, annotated with local install state.
  app.get("/api/starter-models", async () => starterModelsWithState());

  // ── Health ─────────────────────────────────────────────────────────────────
  app.get("/api/health", async (): Promise<HealthStatus> => {
    const reachable = await comfy.ping();
    return {
      backend: "ok",
      comfyui: reachable ? "ok" : "unreachable",
      comfyuiUrl: config.comfyUrl,
      objectInfoCached: comfy.isObjectInfoCached(),
      // Not answering yet but we expect it to (we launched it, or haven't decided) → booting.
      comfyStarting: !reachable && comfySupervisor.isStarting(),
      comfyOwned: comfySupervisor.isOwned(),
    };
  });

  // ── ComfyUI object_info (source of truth for "everything") ──────────────────
  app.get("/api/object-info", async (req) => {
    const refresh = (req.query as { refresh?: string }).refresh === "1";
    return comfy.objectInfo(refresh);
  });

  // ── Model catalog (clean names, thumbnails, Civitai metadata) ────────────────
  const CONTENT_TYPES: Record<string, string> = {
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };

  const ALL_MODEL_KINDS: ModelKind[] = [...MODEL_KIND_VALUES];

  app.get("/api/models", async (req) => {
    const { kind, folder, hidden } = req.query as { kind?: string; folder?: string; hidden?: string };
    if (!kind && !folder) return [];
    // kind="all" (or a folder with no kind) merges every model type.
    const kinds = kind && kind !== "all" ? [kind as ModelKind] : ALL_MODEL_KINDS;
    const onlyHidden = hidden === "1";
    const out = [];
    for (const k of kinds) {
      let models = await catalog.list(k);
      if (folder) {
        const files = modelFolders.filesIn(folder, k);
        models = models.filter((m) => files.has(m.file));
      }
      const hiddenSet = hiddenModels.filesForKind(k);
      models = models.filter((m) => (onlyHidden ? hiddenSet.has(m.file) : !hiddenSet.has(m.file)));
      out.push(...models);
    }
    return out;
  });

  // ── Custom model directories (extra filesystem folders Latent + ComfyUI search) ──
  app.get("/api/model-paths", async () => getCustomModelPaths());

  app.post("/api/model-paths/validate", async (req, reply) => {
    const { path } = (req.body ?? {}) as { path?: string };
    if (!path) return reply.code(400).send({ error: "path required" });
    return validateModelPath(path);
  });

  // Browse the local filesystem (drives + subfolders) for the folder-picker UI.
  app.get("/api/browse-dirs", async (req) => {
    const { path } = (req.query ?? {}) as { path?: string };
    return listDirectories(path ?? "");
  });

  // Scan a "home" folder and auto-detect model subfolders (by name) to add in bulk.
  app.post("/api/model-paths/scan", async (req, reply) => {
    const { home } = (req.body ?? {}) as { home?: string };
    if (!home) return reply.code(400).send({ error: "home required" });
    return detectModelDirs(home);
  });

  // Save the full list, refresh the yaml + catalog. Returns whether ComfyUI needs a
  // restart to actually load models from the new folders (it reads the yaml at boot).
  app.put("/api/model-paths", async (req, reply) => {
    const body = req.body;
    if (!Array.isArray(body)) return reply.code(400).send({ error: "expected an array" });
    setCustomModelPaths(body);
    writeExtraModelPaths();
    catalog.refresh();
    return { ok: true, needsRestart: comfySupervisor.isOwned() };
  });

  // Restart the managed ComfyUI (so it re-reads model paths). Runs in the background.
  app.post("/api/comfy/restart", async () => {
    void comfySupervisor.restart();
    return { ok: true };
  });

  // VRAM-saving mode (fp8 UNet / lowvram launch flags). Needs a ComfyUI restart to apply.
  app.get("/api/vram-mode", async () => ({ mode: getVramMode() }));
  app.put("/api/vram-mode", async (req, reply) => {
    const { mode } = (req.body ?? {}) as { mode?: string };
    if (mode !== "off" && mode !== "balanced" && mode !== "aggressive")
      return reply.code(400).send({ error: "mode must be off | balanced | aggressive" });
    setVramMode(mode);
    return { ok: true, needsRestart: comfySupervisor.isOwned() };
  });

  app.post("/api/models/hide", async (req, reply) => {
    const parsed = modelFileSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const { kind, file, hidden } = parsed.data;
    if (hidden === false) hiddenModels.unset(kind, file);
    else hiddenModels.set(kind, file);
    return { ok: true };
  });

  app.delete("/api/models/file", async (req, reply) => {
    const parsed = modelFileSchema.omit({ hidden: true }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const { kind, file } = parsed.data;
    hiddenModels.unset(kind, file);
    const removed = await catalog.deleteFile(kind, file);
    if (!removed) return reply.code(404).send({ error: "File not found on disk" });
    // The file is gone — drop it from any folders so their counts stay accurate.
    modelFolders.removeItemEverywhere(kind, file);
    return { ok: true };
  });

  app.get("/api/models/preview", async (req, reply) => {
    const { kind, file } = req.query as { kind?: ModelKind; file?: string };
    if (!kind || !file) return reply.code(400).send({ error: "kind and file required" });
    const path = await catalog.previewPath(kind, file);
    if (!path) {
      // No local preview — fall back to the enriched remote thumbnail if present.
      const entry = await catalog.get(kind, file);
      if (entry?.previewUrl) return reply.redirect(entry.previewUrl);
      return reply.code(404).send({ error: "No preview" });
    }
    reply
      .header("content-type", CONTENT_TYPES[extname(path).toLowerCase()] ?? "image/jpeg")
      .header("cache-control", "public, max-age=86400");
    return reply.send(await readFile(path));
  });

  // ── Model folders (user-created groups) ──────────────────────────────────────
  app.get("/api/model-folders", async (req) => {
    const kind = (req.query as { kind?: ModelKind }).kind;
    // Count only members whose file still exists on disk, so a model deleted outside
    // the app doesn't inflate the tally — without deleting the membership row (a model
    // on a temporarily-unavailable drive reappears when it's back).
    const kinds = kind ? [kind] : ALL_MODEL_KINDS;
    const live = new Set<string>();
    for (const k of kinds) for (const m of await catalog.list(k)) live.add(`${k}\u0000${m.file}`);
    return modelFolders.list(kind, (k, file) => live.has(`${k}\u0000${file}`));
  });

  app.post("/api/model-folders", async (req, reply) => {
    const { name } = req.body as { name?: string };
    if (!name || !name.trim()) return reply.code(400).send({ error: "name required" });
    return reply.code(201).send(modelFolders.create(name));
  });

  app.patch("/api/model-folders/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { name } = req.body as { name?: string };
    if (!name || !name.trim()) return reply.code(400).send({ error: "name required" });
    modelFolders.rename(id, name);
    return { ok: true };
  });

  app.delete("/api/model-folders/:id", async (req) => {
    const { id } = req.params as { id: string };
    modelFolders.remove(id);
    return { ok: true };
  });

  app.post("/api/model-folders/:id/items", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { items } = req.body as { items?: { kind: ModelKind; file: string }[] };
    if (!Array.isArray(items) || items.length === 0) {
      return reply.code(400).send({ error: "items required" });
    }
    modelFolders.addItems(id, items);
    return { ok: true, added: items.length };
  });

  app.delete("/api/model-folders/:id/items", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { kind, file } = req.body as { kind?: ModelKind; file?: string };
    if (!kind || !file) return reply.code(400).send({ error: "kind and file required" });
    modelFolders.removeItem(id, kind, file);
    return { ok: true };
  });

  app.get("/api/model-folders/for", async (req) => {
    const { kind, file } = req.query as { kind?: ModelKind; file?: string };
    if (!kind || !file) return [];
    return modelFolders.foldersFor(kind, file);
  });

  // ── Civitai browser + downloads ──────────────────────────────────────────────
  app.get("/api/civitai/search", async (req, reply) => {
    const q = req.query as {
      query?: string;
      kind?: ModelKind;
      sort?: string;
      period?: string;
      baseModels?: string | string[];
      tag?: string;
      username?: string;
      nsfw?: string;
      cursor?: string;
    };
    const baseModels = Array.isArray(q.baseModels)
      ? q.baseModels
      : q.baseModels
        ? [q.baseModels]
        : undefined;
    try {
      return await searchCivitai({
        query: q.query,
        kind: q.kind && q.kind !== ("all" as ModelKind) ? q.kind : undefined,
        sort: q.sort,
        period: q.period,
        baseModels,
        tag: q.tag,
        username: q.username,
        nsfw: q.nsfw !== "false",
        cursor: q.cursor,
      });
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : "Civitai error" });
    }
  });

  app.get("/api/civitai/model/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const model = await getCivitaiModel(Number(id));
    if (!model) return reply.code(404).send({ error: "Not found" });
    return model;
  });

  app.get("/api/downloads", async () => downloads.list());

  app.post("/api/downloads", async (req, reply) => {
    const parsed = downloadSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const { modelId, versionId } = parsed.data;
    try {
      return await downloads.start(modelId, versionId);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Direct URLs and destinations are resolved from the server-owned starter registry.
  app.post("/api/downloads/starter/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const model = starterModelById(id);
    if (!model) return reply.code(404).send({ error: "Starter model not found" });
    try {
      return model.source.type === "civitai"
        ? await downloads.start(model.source.modelId, model.source.versionId)
        : downloads.startStarter(model);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete("/api/downloads/:id", async (req) => {
    const { id } = req.params as { id: string };
    downloads.cancel(id);
    return { ok: true };
  });

  // ── App settings (Civitai API key, …) ────────────────────────────────────────
  app.get("/api/settings", async () => ({
    hasCivitaiApiKey: !!settings.get("civitaiApiKey"),
  }));

  app.put("/api/settings", async (req, reply) => {
    const parsed = z.object({ civitaiApiKey: z.string().max(4096).optional() }).strict().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;
    if (typeof body.civitaiApiKey === "string") settings.set("civitaiApiKey", body.civitaiApiKey.trim());
    return { ok: true };
  });

  // ── Prompt assistant (LLM) config ────────────────────────────────────────────
  // The key is never returned — GET reports only `hasKey`.
  app.get("/api/llm/config", async () => getLlmConfig());

  app.put("/api/llm/config", async (req) => {
    const body = (req.body ?? {}) as Partial<LlmConfigInput>;
    setLlmConfig({
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : "",
      // "" = leave the stored key untouched (the password field is never prefilled).
      apiKey: typeof body.apiKey === "string" ? body.apiKey : "",
      model: typeof body.model === "string" ? body.model : "",
      enabled: body.enabled === true,
    });
    return getLlmConfig();
  });

  // Non-streaming ping so the user can verify their endpoint + key + model.
  app.post("/api/llm/test", async () => {
    try {
      const reply = await chat([
        { role: "user", content: "Reply with exactly the word: ok" },
      ]);
      return { ok: true as const, model: getLlmConfig().model, reply: reply.slice(0, 200) };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Streaming chat with the prompt assistant. Emits SSE: `data: {"delta": "…"}`
  // per token, a terminal `data: {"done": true}`, or `data: {"error": "…"}`.
  app.post("/api/prompt/chat", async (req, reply) => {
    const body = (req.body ?? {}) as { messages?: ChatMessage[]; seed?: PromptSeed };
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) return reply.code(400).send({ error: "messages required" });

    const ac = new AbortController();
    let done = false;

    reply.hijack();
    const raw = reply.raw;
    // Client hit Stop / navigated away before we finished → abort the upstream
    // request. Guarded by `done` so our own normal end doesn't trip the abort.
    raw.on("close", () => {
      if (!done) ac.abort();
    });
    raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const send = (obj: unknown) => raw.write(`data: ${JSON.stringify(obj)}\n\n`);

    // Attach the pipeline's start image (if any) for vision-capable models: fetch
    // it from ComfyUI's input dir and inject it right after the system message.
    const outgoing = withSystem(messages, body.seed);
    const imageRef = body.seed?.imageRef?.trim();
    if (imageRef) {
      try {
        const { buffer, contentType } = await comfy.view({ filename: imageRef, subfolder: "", type: "input" });
        outgoing.splice(1, 0, {
          role: "user",
          content: [
            { type: "text", text: "This is my current start/source image (referenced in the system prompt)." },
            { type: "image_url", image_url: { url: `data:${contentType};base64,${buffer.toString("base64")}` } },
          ],
        });
      } catch {
        /* image unreadable — continue text-only */
      }
    }

    try {
      for await (const delta of chatStream(outgoing, { signal: ac.signal })) {
        send({ delta });
      }
      send({ done: true });
    } catch (err) {
      if (!ac.signal.aborted) send({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      done = true;
      raw.end();
    }
  });

  app.post("/api/models/enrich", async (req, reply) => {
    const parsed = modelFileSchema.omit({ hidden: true }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const { kind, file } = parsed.data;
    const entry = await catalog.get(kind, file);
    if (!entry) return reply.code(404).send({ error: "Unknown model" });
    const patch = await enrichFromCivitai(civitaiQuery(file), kind);
    if (!patch) return reply.code(502).send({ error: "No Civitai match" });
    modelMeta.set(kind, file, patch);
    return catalog.applyEnrichment(kind, file, patch);
  });

  // ── Prompt helpers: tag autocomplete + wildcards ─────────────────────────────
  app.get("/api/tags", async (req) => {
    const { q } = req.query as { q?: string };
    return q ? searchTags(q) : [];
  });

  // Tag-autocomplete data: fresh installs don't ship the (multi-MB) booru tag CSV,
  // so onboarding can fetch it. Hosted as a release asset on the project repo.
  const TAGS_URL =
    "https://github.com/GhostNoodl/latent-studio/releases/download/tags-data/danbooru_e621_merged.csv";
  app.get("/api/tags/status", async () => ({ installed: existsSync(config.tagsCsv) }));
  app.post("/api/tags/download", async () => downloads.startTags(TAGS_URL));

  app.get("/api/wildcards", async () => listWildcards());

  // Read one wildcard's raw contents (name in the query so slashes/sub-folders work).
  app.get("/api/wildcards/file", async (req, reply) => {
    const { name } = req.query as { name?: string };
    if (!name) return reply.code(400).send({ error: "name required" });
    const content = readWildcard(name);
    if (content === null) return reply.code(404).send({ error: "Wildcard not found" });
    return { name, content };
  });

  // Create or overwrite a wildcard file.
  app.put("/api/wildcards/file", async (req, reply) => {
    const { name, content } = (req.body ?? {}) as { name?: string; content?: string };
    if (!name?.trim()) return reply.code(400).send({ error: "name required" });
    if (!writeWildcard(name, content ?? "")) {
      return reply.code(400).send({ error: "Invalid wildcard name" });
    }
    return { ok: true as const };
  });

  app.delete("/api/wildcards/file", async (req, reply) => {
    const { name } = req.query as { name?: string };
    if (!name) return reply.code(400).send({ error: "name required" });
    if (!deleteWildcard(name)) return reply.code(404).send({ error: "Wildcard not found" });
    return { ok: true as const };
  });

  // ── Presets (dimensions / styles / param bundles) ────────────────────────────
  app.get("/api/presets", async (req) => {
    const q = req.query as { kind?: PresetKind; pipelineId?: string };
    return presets.list({ kind: q.kind, pipelineId: q.pipelineId });
  });

  app.post("/api/presets", async (req, reply) => {
    const body = req.body as Partial<Preset>;
    if (!body.kind || !body.name || !body.data) {
      return reply.code(400).send({ error: "kind, name and data required" });
    }
    const preset: Preset = {
      id: nanoid(10),
      kind: body.kind,
      name: body.name,
      pipelineId: body.pipelineId ?? null,
      data: body.data,
      createdAt: new Date().toISOString(),
    };
    presets.create(preset);
    return reply.code(201).send(preset);
  });

  app.delete("/api/presets/:id", async (req) => {
    const { id } = req.params as { id: string };
    presets.remove(id);
    return { ok: true };
  });

  // ── Pipelines (workflow manifests) ──────────────────────────────────────────
  app.get("/api/pipelines", async () => workflows.list());

  app.get("/api/pipelines/:id/requirements", async (req, reply) => {
    const { id } = req.params as { id: string };
    const manifest = workflows.get(id);
    if (!manifest) return reply.code(404).send({ error: "Not found" });
    const refresh = (req.query as { refresh?: string }).refresh === "1";
    const objectInfo = await comfy.objectInfo(refresh);
    return pipelineRequirements(manifest.workflow, objectInfo);
  });

  // Import an API-format workflow: auto-derives the param manifest from object_info.
  app.post("/api/pipelines/import", async (req, reply) => {
    const body = req.body as {
      name?: string;
      type?: WorkflowManifest["type"];
      workflow?: Record<string, unknown>;
      params?: WorkflowManifest["params"];
    };
    if (!body.workflow || typeof body.workflow !== "object") {
      return reply.code(400).send({ error: "Missing workflow JSON" });
    }
    const objectInfo = await comfy.objectInfo();
    const workflow = body.workflow as WorkflowManifest["workflow"];
    const params = body.params ?? buildManifestParams(workflow, objectInfo);
    const now = new Date().toISOString();
    const manifest: WorkflowManifest = {
      id: nanoid(10),
      name: body.name ?? "Imported workflow",
      type: body.type ?? "image",
      workflow,
      params,
      createdAt: now,
      updatedAt: now,
    };
    workflows.upsert(manifest);
    return reply.code(201).send(manifest);
  });

  app.get("/api/pipelines/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const manifest = workflows.get(id);
    if (!manifest) return reply.code(404).send({ error: "Not found" });
    return manifest;
  });

  // Re-derive the control manifest from the stored workflow + fresh object_info
  // (picks up simple/advanced grouping + labelling changes) while carrying over the
  // user's current values by key. Used by "Refresh controls" in the pipeline editor.
  app.post("/api/pipelines/:id/rebuild", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = workflows.get(id);
    if (!existing) return reply.code(404).send({ error: "Not found" });
    const objectInfo = await comfy.objectInfo();
    const prevValues = new Map(existing.params.map((p) => [p.key, p.default]));
    const params = buildManifestParams(existing.workflow, objectInfo).map((p) =>
      prevValues.has(p.key) ? { ...p, default: prevValues.get(p.key) } : p,
    );
    const manifest: WorkflowManifest = { ...existing, params, updatedAt: new Date().toISOString() };
    workflows.upsert(manifest);
    return manifest;
  });

  app.put("/api/pipelines/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Partial<WorkflowManifest>;
    const now = new Date().toISOString();
    const existing = workflows.get(id);
    const manifest: WorkflowManifest = {
      id,
      name: body.name ?? existing?.name ?? id,
      type: body.type ?? existing?.type ?? "image",
      workflow: body.workflow ?? existing?.workflow ?? {},
      params: body.params ?? existing?.params ?? [],
      baseGroup: body.baseGroup ?? existing?.baseGroup,
      mode: body.mode ?? existing?.mode,
      order: body.order ?? existing?.order,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    workflows.upsert(manifest);
    return reply.code(existing ? 200 : 201).send(manifest);
  });

  app.delete("/api/pipelines/:id", async (req) => {
    const { id } = req.params as { id: string };
    workflows.remove(id);
    return { ok: true };
  });

  // ── Generation ──────────────────────────────────────────────────────────────
  app.post("/api/generate", async (req, reply) => {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.message });
    }
    try {
      const ids = await runGeneration(parsed.data);
      return { generationIds: ids };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/interrupt", async () => {
    await comfy.interrupt();
    return { ok: true };
  });

  // ── Logs + lifecycle ──────────────────────────────────────────────────────────
  // Snapshot of captured backend + ComfyUI output (live updates arrive via WS).
  app.get("/api/logs", async (req) => {
    const { source } = req.query as { source?: string };
    const s = source === "backend" || source === "comfy" ? source : undefined;
    return { entries: logs.snapshot(s), comfyOwned: comfySupervisor.isOwned() };
  });

  // Quit Latent from inside the app (stops ComfyUI too). Responds, then exits.
  app.post("/api/shutdown", async (_req, reply) => {
    await reply.send({ ok: true });
    shutdown("quit from app");
  });

  // Is a newer version available on GitHub? (Throttled git fetch behind the scenes.)
  app.get("/api/update/status", async (req) => {
    const force = (req.query as { force?: string })?.force === "1";
    return updateStatus(force);
  });
  // Apply the update: exit with code 42 so the launcher relaunches (which pulls +
  // rebuilds). Only meaningful when Latent was started by its launcher.
  app.post("/api/update/apply", async (_req, reply) => {
    await reply.send({ ok: true });
    shutdown("applying update", 42);
  });

  // ── Queue (live view + management) ────────────────────────────────────────────
  app.get("/api/queue", async (): Promise<QueueSnapshot> => {
    let snap: { queue_running: unknown[][]; queue_pending: unknown[][] };
    try {
      snap = await comfy.queue();
    } catch {
      return { running: [], pending: [] };
    }
    const toItem = (entry: unknown[], running: boolean): QueueItem => {
      const promptId = String(entry[1] ?? "");
      const rec = generations.byPromptId(promptId);
      return {
        promptId,
        generationId: rec?.id,
        pipelineName: rec?.pipelineName,
        seed: rec?.seed,
        thumbnail: rec?.thumbnail,
        running,
      };
    };
    return {
      running: (snap.queue_running ?? []).map((e) => toItem(e, true)),
      pending: (snap.queue_pending ?? []).map((e) => toItem(e, false)),
    };
  });

  // Cancel one queued/running prompt.
  app.post("/api/queue/cancel", async (req, reply) => {
    const { promptId, running } = req.body as { promptId?: string; running?: boolean };
    if (!promptId) return reply.code(400).send({ error: "promptId required" });
    if (running) {
      await comfy.interrupt(); // only the current prompt can be "running"
    } else {
      await comfy.deleteQueued([promptId]);
    }
    // Mark the row canceled + stop tracking either way (don't rely solely on a
    // trailing ComfyUI event, which may not arrive for a deleted/interrupted job).
    const rec = generations.byPromptId(promptId);
    if (rec) {
      const updated = generations.update(rec.id, {
        status: "canceled",
        completedAt: new Date().toISOString(),
      });
      bridge.drop(promptId);
      if (updated) bridge.broadcast({ type: "generation", record: updated });
    }
    return { ok: true };
  });

  // Clear all pending prompts (marks their generations canceled).
  app.post("/api/queue/clear", async () => {
    let pendingIds: string[] = [];
    try {
      const snap = await comfy.queue();
      pendingIds = (snap.queue_pending ?? []).map((e) => String(e[1] ?? "")).filter(Boolean);
    } catch {
      /* comfy unreachable — nothing to clear */
    }
    await comfy.clearQueue();
    for (const promptId of pendingIds) {
      const rec = generations.byPromptId(promptId);
      if (rec) {
        const updated = generations.update(rec.id, {
          status: "canceled",
          completedAt: new Date().toISOString(),
        });
        bridge.drop(promptId);
        if (updated) bridge.broadcast({ type: "generation", record: updated });
      }
    }
    return { ok: true, cleared: pendingIds.length };
  });

  // Post-generation upscale of an existing output.
  app.post("/api/upscale", async (req, reply) => {
    const { generationId, model } = req.body as { generationId?: string; model?: string };
    if (!generationId) return reply.code(400).send({ error: "generationId required" });
    try {
      return { generationId: await runUpscale(generationId, model) };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Post-generation "enhance": ESRGAN upscale + img2img refine (fixes eyes/microdetail).
  app.post("/api/enhance", async (req, reply) => {
    const { generationId } = req.body as { generationId?: string };
    if (!generationId) return reply.code(400).send({ error: "generationId required" });
    try {
      return { generationId: await runEnhance(generationId) };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  app.get("/api/enhance-factor", async () => ({ factor: getEnhanceFactor() }));
  app.put("/api/enhance-factor", async (req, reply) => {
    const { factor } = req.body as { factor?: number };
    if (factor !== 1.5 && factor !== 2) return reply.code(400).send({ error: "factor must be 1.5 or 2" });
    setEnhanceFactor(factor);
    return { ok: true, factor };
  });

  // ── Gallery ──────────────────────────────────────────────────────────────────
  app.get("/api/generations", async (req) => {
    const q = req.query as {
      limit?: string;
      offset?: string;
      favorite?: string;
      collection?: string;
      pipelineId?: string;
      search?: string;
    };
    return generations.list({
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
      favorite: q.favorite === "1" ? true : undefined,
      collection: q.collection || undefined,
      pipelineId: q.pipelineId || undefined,
      search: q.search || undefined,
    });
  });

  app.get("/api/generations/page", async (req) => {
    const q = req.query as {
      limit?: string;
      cursor?: string;
      favorite?: string;
      collection?: string;
      pipelineId?: string;
      search?: string;
    };
    return generations.page({
      limit: q.limit ? Number(q.limit) : undefined,
      cursor: q.cursor || undefined,
      favorite: q.favorite === "1" ? true : undefined,
      collection: q.collection || undefined,
      pipelineId: q.pipelineId || undefined,
      search: q.search || undefined,
    });
  });

  app.get("/api/generations/by-ids", async (req, reply) => {
    const raw = (req.query as { ids?: string }).ids ?? "";
    const ids = raw.split(",").map((id) => id.trim()).filter(Boolean);
    if (ids.length === 0) return [];
    if (ids.length > 256) return reply.code(400).send({ error: "At most 256 ids are allowed" });
    return generations.byIds(ids);
  });

  // Bulk delete (selection actions in the gallery).
  app.post("/api/generations/bulk-delete", async (req, reply) => {
    const parsed = idsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const { ids } = parsed.data;
    generations.removeMany(ids);
    return { ok: true, deleted: ids.length };
  });

  app.get("/api/generations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = generations.get(id);
    if (!rec) return reply.code(404).send({ error: "Not found" });
    return rec;
  });

  app.get("/api/generations/:id/reuse-settings", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return resolveGenerationReuse(id);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.patch("/api/generations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({
      favorite: z.boolean().optional(),
      rating: z.number().int().min(1).max(5).nullable().optional(),
    }).strict().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const body = parsed.data;
    let rec = generations.get(id);
    if (!rec) return reply.code(404).send({ error: "Not found" });
    if (typeof body.favorite === "boolean") rec = generations.setFavorite(id, body.favorite);
    if (body.rating !== undefined) rec = generations.setRating(id, body.rating);
    return rec;
  });

  app.post("/api/generations/:id/tags", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = z.object({ tag: z.string().trim().min(1).max(64) }).strict().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const { tag } = parsed.data;
    const rec = generations.addTag(id, tag);
    if (!rec) return reply.code(404).send({ error: "Not found" });
    return rec;
  });

  app.delete("/api/generations/:id/tags/:tag", async (req, reply) => {
    const { id, tag } = req.params as { id: string; tag: string };
    const rec = generations.removeTag(id, decodeURIComponent(tag));
    if (!rec) return reply.code(404).send({ error: "Not found" });
    return rec;
  });

  app.delete("/api/generations/:id", async (req) => {
    const { id } = req.params as { id: string };
    generations.remove(id);
    return { ok: true };
  });

  // Collections this generation belongs to (for the detail view).
  app.get("/api/generations/:id/collections", async (req) => {
    const { id } = req.params as { id: string };
    return collections.idsFor(id);
  });

  // Reuse a generation's output as a pipeline input (img2img / start frame).
  app.post("/api/generations/:id/to-input", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return { name: await outputToComfyInput(id) };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Collections (named albums) ───────────────────────────────────────────────
  app.get("/api/collections", async () => collections.list());

  app.post("/api/collections", async (req, reply) => {
    const { name } = req.body as { name?: string };
    if (!name || !name.trim()) return reply.code(400).send({ error: "name required" });
    return reply.code(201).send(collections.create(name));
  });

  app.patch("/api/collections/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { name } = req.body as { name?: string };
    if (!name || !name.trim()) return reply.code(400).send({ error: "name required" });
    collections.rename(id, name);
    return { ok: true };
  });

  app.delete("/api/collections/:id", async (req) => {
    const { id } = req.params as { id: string };
    collections.remove(id);
    return { ok: true };
  });

  app.post("/api/collections/:id/items", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = idsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const { ids } = parsed.data;
    collections.addItems(id, ids);
    return { ok: true, added: ids.length };
  });

  app.delete("/api/collections/:id/items/:genId", async (req) => {
    const { id, genId } = req.params as { id: string; genId: string };
    collections.removeItem(id, genId);
    return { ok: true };
  });

  // ── Image upload (forwarded to ComfyUI for img2img / WAN start frame) ────────
  app.post("/api/upload", async (req, reply) => {
    const parsed = uploadSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const { filename, dataBase64, contentType } = parsed.data;
    const buffer = Buffer.from(dataBase64, "base64");
    const result = await comfy.uploadImage(
      filename,
      buffer,
      contentType ?? "image/png",
    );
    return result;
  });

  // Smart auto-masking: detect faces/hands/person in a ComfyUI input image and
  // return the combined-mask PNG (white = detected) for the mask editor to load.
  app.post("/api/automask", async (req, reply) => {
    const { image, detector } = (req.body ?? {}) as { image?: string; detector?: string };
    if (!image) return reply.code(400).send({ error: "image required" });
    try {
      const buffer = await runAutoMask(image, detector);
      return reply.header("content-type", "image/png").header("cache-control", "no-store").send(buffer);
    } catch (e) {
      return reply.code(500).send({ error: e instanceof Error ? e.message : "auto-mask failed" });
    }
  });

  // Preview a ControlNet preprocessor's control map (canny/depth/pose/…) over a
  // source image, so the user sees what will guide generation before running.
  app.post("/api/cn-preview", async (req, reply) => {
    const { image, preprocessor, resolution } = (req.body ?? {}) as {
      image?: string;
      preprocessor?: string;
      resolution?: number;
    };
    if (!image || !preprocessor) return reply.code(400).send({ error: "image + preprocessor required" });
    if (preprocessor === "none") return reply.code(400).send({ error: "no preprocessor selected" });
    try {
      const buffer = await runCnPreview(image, preprocessor, resolution ?? 512);
      return reply.header("content-type", "image/png").header("cache-control", "no-store").send(buffer);
    } catch (e) {
      return reply.code(500).send({ error: e instanceof Error ? e.message : "preview failed" });
    }
  });

  // Serve a ComfyUI *input* image (an uploaded source) so the mask editor can
  // paint over it as a backdrop.
  app.get("/api/comfy-input", async (req, reply) => {
    const { name, subfolder } = req.query as { name?: string; subfolder?: string };
    if (!name) return reply.code(400).send({ error: "name required" });
    try {
      const { buffer, contentType } = await comfy.view({
        filename: name,
        subfolder: subfolder ?? "",
        type: "input",
      });
      return reply.header("content-type", contentType).header("cache-control", "no-store").send(buffer);
    } catch {
      return reply.code(404).send({ error: "input image not found" });
    }
  });

  // ── Browser WebSocket (fan-out of ComfyUI events) ───────────────────────────
  app.get("/ws", { websocket: true }, (socket) => {
    const send = (ev: ServerEvent) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(ev));
    };
    const sink = {
      send,
      sendPreview: (meta: import("./ws-bridge.ts").PreviewMeta, bytes: Buffer) => {
        if (socket.readyState !== socket.OPEN) return;
        const header = Buffer.from(JSON.stringify(meta));
        const frame = Buffer.allocUnsafe(4 + header.length + bytes.length);
        frame.writeUInt32BE(header.length, 0);
        header.copy(frame, 4);
        bytes.copy(frame, 4 + header.length);
        socket.send(frame, { binary: true });
      },
    };
    bridge.addBrowser(sink);
    socket.on("close", () => bridge.removeBrowser(sink));
    socket.on("error", () => bridge.removeBrowser(sink));
  });
}
