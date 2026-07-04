import { createWriteStream } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { nanoid } from "nanoid";
import { config } from "./config.ts";
import { catalog, KIND_FOLDERS } from "./models-catalog.ts";
import { getCivitaiModel, getCivitaiKey, CIVITAI_TYPE_TO_KIND } from "./civitai.ts";
import { bridge } from "./ws-bridge.ts";
import type { CivitaiFile, CivitaiModelResult, CivitaiVersion, DownloadJob, ModelKind } from "@latent/shared";

/**
 * Streams a chosen Civitai model file into the correct Stability Matrix folder,
 * writing SM-style sidecars (.cm-info.json + .preview.<ext>) so the existing
 * catalog picks it up. Progress is broadcast over the WS bridge; a snapshot is
 * exposed for polling. In-memory only (downloads don't survive a restart).
 */

interface Job extends DownloadJob {
  controller: AbortController;
}

const jobs = new Map<string, Job>();

function pub(j: Job): DownloadJob {
  const { controller: _c, ...rest } = j;
  return rest;
}
function emit(j: Job): void {
  bridge.broadcast({ type: "download", job: pub(j) });
}

export const downloads = {
  list(): DownloadJob[] {
    return [...jobs.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(pub);
  },

  cancel(id: string): void {
    const j = jobs.get(id);
    if (j && j.status === "downloading") j.controller.abort();
  },

  /** Resolve the model, pick the version's primary file, and start streaming. */
  async start(modelId: number, versionId: number): Promise<DownloadJob> {
    const model = await getCivitaiModel(modelId);
    if (!model) throw new Error("Model not found on Civitai");
    const version = model.versions.find((v) => v.id === versionId) ?? model.versions[0];
    if (!version) throw new Error("No version to download");
    const file = version.files.find((f) => f.primary) ?? version.files[0];
    if (!file?.name) throw new Error("No downloadable file for this version");
    const kind = CIVITAI_TYPE_TO_KIND[model.type];
    if (!kind) throw new Error(`Unsupported model type: ${model.type || "unknown"}`);

    const job = newJob({ name: file.name, kind, total: file.sizeKB * 1024 });
    void run(job, model, version, file);
    return pub(job);
  },

  /**
   * Download a file from an arbitrary (e.g. HuggingFace) URL into a target folder.
   * Used by first-run onboarding for models that aren't on Civitai (text encoders,
   * WAN VAE, RIFE, upscalers). No Civitai sidecar is written.
   */
  startUrl(opts: {
    url: string;
    folder: string;
    filename: string;
    kind?: ModelKind;
    name?: string;
    sizeBytes?: number;
    headers?: Record<string, string>;
  }): DownloadJob {
    const job = newJob({
      name: opts.name ?? opts.filename,
      kind: opts.kind ?? "other",
      total: opts.sizeBytes ?? 0,
    });
    void runUrl(job, opts);
    return pub(job);
  },
};

function newJob(o: { name: string; kind: ModelKind | "other"; total: number }): Job {
  const job: Job = {
    id: nanoid(10),
    name: o.name,
    kind: o.kind,
    status: "downloading",
    received: 0,
    total: o.total,
    createdAt: new Date().toISOString(),
    controller: new AbortController(),
  };
  jobs.set(job.id, job);
  emit(job);
  return job;
}

/** Shared streaming core: fetch → <dest>.part (with live progress) → rename. Throws on failure. */
async function streamTo(
  job: Job,
  url: string,
  dir: string,
  filename: string,
  headers?: Record<string, string>,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const res = await fetch(url, { signal: job.controller.signal, redirect: "follow", headers });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  job.total = Number(res.headers.get("content-length")) || job.total;

  let lastEmit = 0;
  const body = Readable.fromWeb(res.body as unknown as NodeWebReadableStream<Uint8Array>);
  body.on("data", (chunk: Buffer) => {
    job.received += chunk.length;
    const now = Date.now();
    if (now - lastEmit > 400) {
      lastEmit = now;
      emit(job);
    }
  });
  await pipeline(body, createWriteStream(join(dir, `${filename}.part`)));
  await rename(join(dir, `${filename}.part`), join(dir, filename));
}

/** Finalize a job as completed / canceled / failed and clean up any .part on error. */
async function finish(job: Job, dir: string, filename: string, err?: unknown): Promise<void> {
  if (!err) {
    job.status = "completed";
    if (job.total) job.received = job.total;
  } else {
    await unlink(join(dir, `${filename}.part`)).catch(() => {});
    job.status = job.controller.signal.aborted ? "canceled" : "failed";
    if (job.status === "failed") job.error = err instanceof Error ? err.message : String(err);
  }
  emit(job);
}

async function run(
  job: Job,
  model: CivitaiModelResult,
  version: CivitaiVersion,
  file: CivitaiFile,
): Promise<void> {
  const folder = job.kind !== "other" ? (KIND_FOLDERS[job.kind][0] ?? "") : "";
  const dir = join(config.smModelsDir, folder);
  try {
    let url = file.downloadUrl;
    const key = getCivitaiKey();
    if (key && !/[?&]token=/.test(url)) url += `${url.includes("?") ? "&" : "?"}token=${key}`;
    await streamTo(job, url, dir, file.name);
    await writeSidecars(dir, file.name, model, version);
    if (job.kind !== "other") catalog.list(job.kind, true); // refresh BEFORE announcing
    await finish(job, dir, file.name);
  } catch (err) {
    await finish(job, dir, file.name, err);
  }
}

async function runUrl(
  job: Job,
  opts: { url: string; folder: string; filename: string; kind?: ModelKind; headers?: Record<string, string> },
): Promise<void> {
  const dir = join(config.smModelsDir, opts.folder);
  try {
    await streamTo(job, opts.url, dir, opts.filename, opts.headers);
    if (opts.kind) catalog.list(opts.kind, true);
    await finish(job, dir, opts.filename);
  } catch (err) {
    await finish(job, dir, opts.filename, err);
  }
}

/** Write Stability Matrix-style sidecars so the catalog shows rich metadata. */
async function writeSidecars(
  dir: string,
  fileName: string,
  model: CivitaiModelResult,
  version: CivitaiVersion,
): Promise<void> {
  const base = fileName.replace(/\.[^.]+$/, "");
  const cm = {
    ModelName: model.name,
    ModelType: model.type,
    VersionName: version.name,
    BaseModel: version.baseModel,
    AuthorUsername: model.author,
    TrainedWords: version.trainedWords,
    Tags: model.tags,
    Nsfw: model.nsfw,
    ModelId: model.id,
    VersionId: version.id,
    Stats: model.stats,
  };
  await writeFile(join(dir, `${base}.cm-info.json`), JSON.stringify(cm, null, 2));

  // Prefer a still image — a video preview would save as an unopenable .jpeg.
  const imgUrl =
    version.images.find((i) => i.url && i.type !== "video")?.url ??
    version.images.find((i) => i.url)?.url;
  if (!imgUrl) return;
  try {
    const r = await fetch(imgUrl, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return;
    const ct = r.headers.get("content-type") ?? "";
    if (ct.startsWith("video/")) return; // never write a video as a preview image
    const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpeg";
    await writeFile(join(dir, `${base}.preview.${ext}`), Buffer.from(await r.arrayBuffer()));
  } catch {
    /* preview is best-effort */
  }
}
