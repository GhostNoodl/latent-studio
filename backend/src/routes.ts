import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { config } from "./config.ts";
import { comfy } from "./comfy.ts";
import { generations, workflows, modelMeta, presets, collections, modelFolders, settings, hiddenModels } from "./db.ts";
import { bridge } from "./ws-bridge.ts";
import { runGeneration, runUpscale, outputToComfyInput } from "./generate.ts";
import { comfyEnv } from "./comfy-env.ts";
import { buildManifestParams } from "./manifest-builder.ts";
import { catalog } from "./models-catalog.ts";
import { enrichFromCivitai, civitaiQuery, searchCivitai, getCivitaiModel } from "./civitai.ts";
import { downloads } from "./downloads.ts";
import { starterModelsWithState } from "./starter-models.ts";
import { seedDefaultPipelines } from "./seed.ts";
import { runAutoMask } from "./automask.ts";
import { runCnPreview } from "./cn-preview.ts";
import { logs } from "./logs.ts";
import { comfySupervisor } from "./comfy-supervisor.ts";
import { shutdown } from "./lifecycle.ts";
import { searchTags } from "./tags.ts";
import { listWildcards, readWildcard, writeWildcard, deleteWildcard } from "./wildcards.ts";
import { nanoid } from "nanoid";
import type {
  HealthStatus,
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
  pipelineId: z.string(),
  values: z.record(z.string(), z.any()),
  rawWorkflow: z.record(z.string(), z.any()).optional(),
  seedMode: z.enum(["fixed", "random", "increment"]).optional(),
  batch: z.number().int().min(1).max(64).optional(),
  runs: z.array(z.record(z.string(), z.any())).max(256).optional(),
});

const uploadSchema = z.object({
  filename: z.string(),
  dataBase64: z.string(),
  contentType: z.string().optional(),
});

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Optional LAN access token guard for /api and /ws.
  if (config.accessToken) {
    app.addHook("onRequest", async (req, reply) => {
      if (!req.url.startsWith("/api") && !req.url.startsWith("/ws")) return;
      const token =
        (req.headers["x-access-token"] as string | undefined) ??
        (req.query as Record<string, string | undefined>)?.token;
      if (token !== config.accessToken) {
        reply.code(401).send({ error: "Unauthorized" });
      }
    });
  }

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

  const ALL_MODEL_KINDS: ModelKind[] = [
    "checkpoint",
    "diffusion",
    "lora",
    "vae",
    "upscale",
    "controlnet",
    "embedding",
  ];

  app.get("/api/models", async (req) => {
    const { kind, folder, hidden } = req.query as { kind?: string; folder?: string; hidden?: string };
    if (!kind && !folder) return [];
    // kind="all" (or a folder with no kind) merges every model type.
    const kinds = kind && kind !== "all" ? [kind as ModelKind] : ALL_MODEL_KINDS;
    const onlyHidden = hidden === "1";
    const out = [];
    for (const k of kinds) {
      let models = catalog.list(k);
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

  app.post("/api/models/hide", async (req, reply) => {
    const { kind, file, hidden } = req.body as { kind?: ModelKind; file?: string; hidden?: boolean };
    if (!kind || !file) return reply.code(400).send({ error: "kind and file required" });
    if (hidden === false) hiddenModels.unset(kind, file);
    else hiddenModels.set(kind, file);
    return { ok: true };
  });

  app.delete("/api/models/file", async (req, reply) => {
    const { kind, file } = req.body as { kind?: ModelKind; file?: string };
    if (!kind || !file) return reply.code(400).send({ error: "kind and file required" });
    hiddenModels.unset(kind, file);
    const removed = catalog.deleteFile(kind, file);
    if (!removed) return reply.code(404).send({ error: "File not found on disk" });
    return { ok: true };
  });

  app.get("/api/models/preview", async (req, reply) => {
    const { kind, file } = req.query as { kind?: ModelKind; file?: string };
    if (!kind || !file) return reply.code(400).send({ error: "kind and file required" });
    const path = catalog.previewPath(kind, file);
    if (!path) {
      // No local preview — fall back to the enriched remote thumbnail if present.
      const entry = catalog.get(kind, file);
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
    return modelFolders.list(kind);
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
    const { modelId, versionId } = req.body as { modelId?: number; versionId?: number };
    if (!modelId || !versionId) return reply.code(400).send({ error: "modelId and versionId required" });
    try {
      return await downloads.start(modelId, versionId);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Download from an arbitrary URL (HuggingFace, etc.) into a target folder — for
  // onboarding's curated models that aren't on Civitai (text encoders, WAN VAE, RIFE…).
  app.post("/api/downloads/url", async (req, reply) => {
    const body = req.body as {
      url?: string;
      folder?: string;
      filename?: string;
      kind?: ModelKind;
      name?: string;
      sizeBytes?: number;
      headers?: Record<string, string>;
    };
    if (!body.url || !body.folder || !body.filename) {
      return reply.code(400).send({ error: "url, folder and filename required" });
    }
    try {
      return downloads.startUrl({
        url: body.url,
        folder: body.folder,
        filename: body.filename,
        kind: body.kind,
        name: body.name,
        sizeBytes: body.sizeBytes,
        headers: body.headers,
      });
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
    civitaiApiKey: settings.get("civitaiApiKey") ?? "",
  }));

  app.put("/api/settings", async (req) => {
    const body = req.body as { civitaiApiKey?: string };
    if (typeof body.civitaiApiKey === "string") settings.set("civitaiApiKey", body.civitaiApiKey.trim());
    return { ok: true };
  });

  app.post("/api/models/enrich", async (req, reply) => {
    const { kind, file } = req.body as { kind?: ModelKind; file?: string };
    if (!kind || !file) return reply.code(400).send({ error: "kind and file required" });
    const entry = catalog.get(kind, file);
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

  // Import an API-format workflow: auto-derives the param manifest from object_info.
  app.post("/api/pipelines/import", async (req, reply) => {
    const body = req.body as {
      name?: string;
      type?: "image" | "video";
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

  // Bulk delete (selection actions in the gallery).
  app.post("/api/generations/bulk-delete", async (req, reply) => {
    const { ids } = req.body as { ids?: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.code(400).send({ error: "ids required" });
    }
    generations.removeMany(ids);
    return { ok: true, deleted: ids.length };
  });

  app.get("/api/generations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = generations.get(id);
    if (!rec) return reply.code(404).send({ error: "Not found" });
    return rec;
  });

  app.patch("/api/generations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { favorite?: boolean; rating?: number | null };
    let rec = generations.get(id);
    if (!rec) return reply.code(404).send({ error: "Not found" });
    if (typeof body.favorite === "boolean") rec = generations.setFavorite(id, body.favorite);
    if (body.rating !== undefined) rec = generations.setRating(id, body.rating);
    return rec;
  });

  app.post("/api/generations/:id/tags", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { tag } = req.body as { tag?: string };
    if (!tag) return reply.code(400).send({ error: "Missing tag" });
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
    const { ids } = req.body as { ids?: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.code(400).send({ error: "ids required" });
    }
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
    bridge.addBrowser(send);
    socket.on("close", () => bridge.removeBrowser(send));
    socket.on("error", () => bridge.removeBrowser(send));
  });
}
