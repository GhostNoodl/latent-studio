import type {
  AuthStatus,
  ChatMessage,
  CivitaiModelResult,
  CivitaiSearchResult,
  Collection,
  CustomModelPath,
  DownloadJob,
  GenerateRequest,
  GenerateResponse,
  GenerationRecord,
  HealthStatus,
  LlmConfig,
  LlmConfigInput,
  LogEntry,
  ModelFolder,
  ModelInfo,
  ModelKind,
  OnboardingStatus,
  StarterModelState,
  ObjectInfo,
  Preset,
  PresetKind,
  QueueSnapshot,
  SetupStatus,
  TagSuggestion,
  WorkflowManifest,
} from "@latent/shared";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  // Only declare a JSON content-type when we actually send a body — Fastify rejects
  // `content-type: application/json` with an empty body (FST_ERR_CTP_EMPTY_JSON_BODY,
  // 400), which would otherwise break every bodyless POST/DELETE (interrupt, delete, …).
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body != null ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const message = body.error ?? `Request failed: ${res.status}`;
    if (!path.startsWith("/api/auth/")) {
      window.dispatchEvent(new CustomEvent("latent:api-error", { detail: { message, path } }));
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

interface PromptChatSeed {
  positive?: string;
  negative?: string;
  pipelineName?: string;
  /** Pipeline base group (e.g. "MiniMax H3") — selects the assistant's prompt dialect. */
  pipelineGroup?: string;
  pipelineType?: "image" | "video";
  /** Start/source image filename in ComfyUI's input dir — attached for vision models. */
  imageRef?: string;
}

/**
 * Stream a chat with the prompt assistant. Reads the SSE response body and calls
 * `onToken` for each delta. Resolves when the stream ends; rejects on a provider
 * error. Pass an AbortSignal (from the caller's controller) to Stop mid-stream.
 */
async function promptChatStream(
  body: { messages: ChatMessage[]; seed?: PromptChatSeed },
  onToken: (delta: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/prompt/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `Request failed: ${res.status}`);
  }
  if (!res.body) throw new Error("No response stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const event = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of event.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        const msg = JSON.parse(payload) as { delta?: string; done?: boolean; error?: string };
        if (msg.error) throw new Error(msg.error);
        if (msg.done) return;
        if (msg.delta) onToken(msg.delta);
      }
    }
  }
}

export const api = {
  authStatus: () => http<AuthStatus>("/api/auth/status"),
  createSession: (token: string) =>
    http<{ ok: true }>("/api/auth/session", { method: "POST", body: JSON.stringify({ token }) }),
  pairingInfo: () => http<{ token: string; path: string }>("/api/auth/pairing"),

  health: () => http<HealthStatus>("/api/health"),

  // First-run ComfyUI setup
  setupStatus: () => http<SetupStatus>("/api/setup/status"),
  startSetup: (force = false) =>
    http<{ ok: true }>("/api/setup/bootstrap", { method: "POST", body: JSON.stringify({ force }) }),
  launchManaged: () => http<{ ok: true; launched: boolean }>("/api/setup/launch", { method: "POST" }),

  objectInfo: (refresh = false) =>
    http<ObjectInfo>(`/api/object-info${refresh ? "?refresh=1" : ""}`),

  pipelines: () => http<WorkflowManifest[]>("/api/pipelines"),
  pipeline: (id: string) => http<WorkflowManifest>(`/api/pipelines/${id}`),
  savePipeline: (m: WorkflowManifest) =>
    http<WorkflowManifest>(`/api/pipelines/${m.id}`, {
      method: "PUT",
      body: JSON.stringify(m),
    }),
  importPipeline: (body: { name: string; type: "image" | "video"; workflow: Record<string, unknown> }) =>
    http<WorkflowManifest>("/api/pipelines/import", { method: "POST", body: JSON.stringify(body) }),
  deletePipeline: (id: string) =>
    http<{ ok: true }>(`/api/pipelines/${id}`, { method: "DELETE" }),
  rebuildPipeline: (id: string) =>
    http<WorkflowManifest>(`/api/pipelines/${id}/rebuild`, { method: "POST" }),

  generate: (req: GenerateRequest) =>
    http<GenerateResponse>("/api/generate", { method: "POST", body: JSON.stringify(req) }),
  interrupt: () => http<{ ok: true }>("/api/interrupt", { method: "POST" }),

  logs: (source?: "backend" | "comfy") =>
    http<{ entries: LogEntry[]; comfyOwned: boolean }>(`/api/logs${source ? `?source=${source}` : ""}`),
  shutdown: () => http<{ ok: true }>("/api/shutdown", { method: "POST" }),

  // Queue management
  queue: () => http<QueueSnapshot>("/api/queue"),
  cancelQueued: (promptId: string, running: boolean) =>
    http<{ ok: true }>("/api/queue/cancel", {
      method: "POST",
      body: JSON.stringify({ promptId, running }),
    }),
  clearQueue: () => http<{ ok: true; cleared: number }>("/api/queue/clear", { method: "POST" }),

  upscale: (generationId: string, model?: string) =>
    http<{ generationId: string }>("/api/upscale", {
      method: "POST",
      body: JSON.stringify({ generationId, model }),
    }),
  enhance: (generationId: string) =>
    http<{ generationId: string }>("/api/enhance", {
      method: "POST",
      body: JSON.stringify({ generationId }),
    }),
  enhanceFactor: () => http<{ factor: number }>("/api/enhance-factor"),
  saveEnhanceFactor: (factor: number) =>
    http<{ ok: true; factor: number }>("/api/enhance-factor", {
      method: "PUT",
      body: JSON.stringify({ factor }),
    }),

  generations: (
    params: {
      limit?: number;
      offset?: number;
      favorite?: boolean;
      collection?: string;
      pipelineId?: string;
      search?: string;
    } = {},
  ) => {
    const qs = new URLSearchParams();
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.offset) qs.set("offset", String(params.offset));
    if (params.favorite) qs.set("favorite", "1");
    if (params.collection) qs.set("collection", params.collection);
    if (params.pipelineId) qs.set("pipelineId", params.pipelineId);
    if (params.search?.trim()) qs.set("search", params.search.trim());
    return http<GenerationRecord[]>(`/api/generations?${qs.toString()}`);
  },
  generationPage: (params: {
    limit?: number;
    cursor?: string;
    favorite?: boolean;
    collection?: string;
    pipelineId?: string;
    search?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.cursor) qs.set("cursor", params.cursor);
    if (params.favorite) qs.set("favorite", "1");
    if (params.collection) qs.set("collection", params.collection);
    if (params.pipelineId) qs.set("pipelineId", params.pipelineId);
    if (params.search?.trim()) qs.set("search", params.search.trim());
    return http<{ items: GenerationRecord[]; nextCursor?: string }>(
      `/api/generations/page?${qs.toString()}`,
    );
  },
  generationsByIds: (ids: string[]) => {
    const qs = new URLSearchParams({ ids: ids.slice(0, 256).join(",") });
    return http<GenerationRecord[]>(`/api/generations/by-ids?${qs.toString()}`);
  },
  generation: (id: string) => http<GenerationRecord>(`/api/generations/${id}`),
  setFavorite: (id: string, favorite: boolean) =>
    http<GenerationRecord>(`/api/generations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ favorite }),
    }),
  setRating: (id: string, rating: number | null) =>
    http<GenerationRecord>(`/api/generations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ rating }),
    }),
  addTag: (id: string, tag: string) =>
    http<GenerationRecord>(`/api/generations/${id}/tags`, {
      method: "POST",
      body: JSON.stringify({ tag }),
    }),
  removeTag: (id: string, tag: string) =>
    http<GenerationRecord>(`/api/generations/${id}/tags/${encodeURIComponent(tag)}`, {
      method: "DELETE",
    }),
  deleteGeneration: (id: string) =>
    http<{ ok: true }>(`/api/generations/${id}`, { method: "DELETE" }),
  bulkDelete: (ids: string[]) =>
    http<{ ok: true; deleted: number }>("/api/generations/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  /** Push a generation's output into ComfyUI's input folder; returns the input name. */
  toInput: (id: string) =>
    http<{ name: string }>(`/api/generations/${id}/to-input`, { method: "POST" }),
  collectionsFor: (id: string) => http<string[]>(`/api/generations/${id}/collections`),

  uploadImage: (filename: string, dataBase64: string, contentType: string) =>
    http<{ name: string; subfolder: string; type: string }>("/api/upload", {
      method: "POST",
      body: JSON.stringify({ filename, dataBase64, contentType }),
    }),

  // Model catalog (clean names, thumbnails, Civitai metadata). kind="all" merges types.
  models: (kind: ModelKind | "all", folder?: string, opts?: { hidden?: boolean }) => {
    const qs = new URLSearchParams({ kind });
    if (folder) qs.set("folder", folder);
    if (opts?.hidden) qs.set("hidden", "1");
    return http<ModelInfo[]>(`/api/models?${qs.toString()}`);
  },
  hideModel: (kind: ModelKind, file: string, hidden = true) =>
    http<{ ok: true }>("/api/models/hide", {
      method: "POST",
      body: JSON.stringify({ kind, file, hidden }),
    }),
  deleteModelFile: (kind: ModelKind, file: string) =>
    http<{ ok: true }>("/api/models/file", {
      method: "DELETE",
      body: JSON.stringify({ kind, file }),
    }),
  enrichModel: (kind: ModelKind, file: string) =>
    http<ModelInfo>("/api/models/enrich", {
      method: "POST",
      body: JSON.stringify({ kind, file }),
    }),
  modelPreviewUrl: (kind: ModelKind, file: string) =>
    `/api/models/preview?kind=${kind}&file=${encodeURIComponent(file)}`,

  // Model folders (user-created groups)
  modelFolders: (kind?: ModelKind) =>
    http<ModelFolder[]>(`/api/model-folders${kind ? `?kind=${kind}` : ""}`),
  createModelFolder: (name: string) =>
    http<ModelFolder>("/api/model-folders", { method: "POST", body: JSON.stringify({ name }) }),
  renameModelFolder: (id: string, name: string) =>
    http<{ ok: true }>(`/api/model-folders/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteModelFolder: (id: string) =>
    http<{ ok: true }>(`/api/model-folders/${id}`, { method: "DELETE" }),
  addToModelFolder: (id: string, items: { kind: ModelKind; file: string }[]) =>
    http<{ ok: true; added: number }>(`/api/model-folders/${id}/items`, {
      method: "POST",
      body: JSON.stringify({ items }),
    }),
  removeFromModelFolder: (id: string, kind: ModelKind, file: string) =>
    http<{ ok: true }>(`/api/model-folders/${id}/items`, {
      method: "DELETE",
      body: JSON.stringify({ kind, file }),
    }),
  modelFoldersFor: (kind: ModelKind, file: string) =>
    http<string[]>(`/api/model-folders/for?kind=${kind}&file=${encodeURIComponent(file)}`),

  // Civitai browser + downloads
  civitaiSearch: (params: {
    query?: string;
    kind?: ModelKind | "all";
    sort?: string;
    period?: string;
    baseModels?: string[];
    tag?: string;
    username?: string;
    nsfw?: boolean;
    cursor?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params.query) qs.set("query", params.query);
    if (params.kind && params.kind !== "all") qs.set("kind", params.kind);
    if (params.sort) qs.set("sort", params.sort);
    if (params.period) qs.set("period", params.period);
    for (const bm of params.baseModels ?? []) qs.append("baseModels", bm);
    if (params.tag) qs.set("tag", params.tag);
    if (params.username) qs.set("username", params.username);
    if (params.nsfw === false) qs.set("nsfw", "false");
    if (params.cursor) qs.set("cursor", params.cursor);
    return http<CivitaiSearchResult>(`/api/civitai/search?${qs.toString()}`);
  },
  civitaiModel: (id: number) => http<CivitaiModelResult>(`/api/civitai/model/${id}`),
  startDownload: (modelId: number, versionId: number) =>
    http<DownloadJob>("/api/downloads", { method: "POST", body: JSON.stringify({ modelId, versionId }) }),
  downloads: () => http<DownloadJob[]>("/api/downloads"),
  cancelDownload: (id: string) => http<{ ok: true }>(`/api/downloads/${id}`, { method: "DELETE" }),
  startStarterDownload: (id: string) =>
    http<DownloadJob>(`/api/downloads/starter/${encodeURIComponent(id)}`, { method: "POST" }),

  // Onboarding + curated starter models
  starterModels: () => http<StarterModelState[]>("/api/starter-models"),
  onboarding: () => http<OnboardingStatus>("/api/onboarding"),
  completeOnboarding: () => http<{ ok: true }>("/api/onboarding/complete", { method: "POST" }),
  resetOnboarding: () => http<{ ok: true }>("/api/onboarding/reset", { method: "POST" }),
  seedPipelines: () => http<{ seeded: number }>("/api/setup/seed-pipelines", { method: "POST" }),

  // App settings
  settings: () => http<{ hasCivitaiApiKey: boolean }>("/api/settings"),
  saveSettings: (body: { civitaiApiKey?: string }) =>
    http<{ ok: true }>("/api/settings", { method: "PUT", body: JSON.stringify(body) }),

  // Prompt assistant (LLM) config
  llmConfig: () => http<LlmConfig>("/api/llm/config"),
  saveLlmConfig: (body: LlmConfigInput) =>
    http<LlmConfig>("/api/llm/config", { method: "PUT", body: JSON.stringify(body) }),
  testLlm: () =>
    http<{ ok: boolean; model?: string; reply?: string; error?: string }>("/api/llm/test", {
      method: "POST",
    }),
  promptChatStream,

  // Custom model directories (extra filesystem folders searched for models)
  modelPaths: () => http<CustomModelPath[]>("/api/model-paths"),
  saveModelPaths: (paths: CustomModelPath[]) =>
    http<{ ok: true; needsRestart: boolean }>("/api/model-paths", {
      method: "PUT",
      body: JSON.stringify(paths),
    }),
  validateModelPath: (path: string) =>
    http<{ exists: boolean; modelCount: number }>("/api/model-paths/validate", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  scanModelHome: (home: string) =>
    http<{ path: string; kind: ModelKind; count: number }[]>("/api/model-paths/scan", {
      method: "POST",
      body: JSON.stringify({ home }),
    }),
  restartComfy: () => http<{ ok: true }>("/api/comfy/restart", { method: "POST" }),
  updateStatus: () =>
    http<{ available: boolean; behind: number; current: string; latest: string; subject: string }>(
      "/api/update/status",
    ),
  applyUpdate: () => http<{ ok: true }>("/api/update/apply", { method: "POST" }),
  vramMode: () => http<{ mode: "off" | "balanced" | "aggressive" }>("/api/vram-mode"),
  saveVramMode: (mode: "off" | "balanced" | "aggressive") =>
    http<{ ok: true; needsRestart: boolean }>("/api/vram-mode", {
      method: "PUT",
      body: JSON.stringify({ mode }),
    }),
  browseDirs: (path: string) =>
    http<{ path: string; parent: string | null; dirs: { name: string; path: string }[] }>(
      `/api/browse-dirs?path=${encodeURIComponent(path)}`,
    ),

  // Presets
  presets: (params: { kind?: PresetKind; pipelineId?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.kind) qs.set("kind", params.kind);
    if (params.pipelineId) qs.set("pipelineId", params.pipelineId);
    return http<Preset[]>(`/api/presets?${qs.toString()}`);
  },
  createPreset: (preset: Omit<Preset, "id" | "createdAt">) =>
    http<Preset>("/api/presets", { method: "POST", body: JSON.stringify(preset) }),
  deletePreset: (id: string) =>
    http<{ ok: true }>(`/api/presets/${id}`, { method: "DELETE" }),

  // Prompt helpers
  tags: (q: string) => http<TagSuggestion[]>(`/api/tags?q=${encodeURIComponent(q)}`),
  tagsStatus: () => http<{ installed: boolean }>("/api/tags/status"),
  downloadTags: () => http<DownloadJob>("/api/tags/download", { method: "POST" }),
  wildcards: () => http<string[]>("/api/wildcards"),
  wildcard: (name: string) =>
    http<{ name: string; content: string }>(`/api/wildcards/file?name=${encodeURIComponent(name)}`),
  saveWildcard: (name: string, content: string) =>
    http<{ ok: true }>("/api/wildcards/file", {
      method: "PUT",
      body: JSON.stringify({ name, content }),
    }),
  deleteWildcard: (name: string) =>
    http<{ ok: true }>(`/api/wildcards/file?name=${encodeURIComponent(name)}`, { method: "DELETE" }),

  // Collections
  collections: () => http<Collection[]>("/api/collections"),
  createCollection: (name: string) =>
    http<Collection>("/api/collections", { method: "POST", body: JSON.stringify({ name }) }),
  renameCollection: (id: string, name: string) =>
    http<{ ok: true }>(`/api/collections/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  deleteCollection: (id: string) =>
    http<{ ok: true }>(`/api/collections/${id}`, { method: "DELETE" }),
  addToCollection: (id: string, ids: string[]) =>
    http<{ ok: true; added: number }>(`/api/collections/${id}/items`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  removeFromCollection: (id: string, genId: string) =>
    http<{ ok: true }>(`/api/collections/${id}/items/${genId}`, { method: "DELETE" }),
};
