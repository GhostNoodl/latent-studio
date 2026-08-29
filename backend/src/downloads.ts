import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat, statfs, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { nanoid } from "nanoid";
import { config } from "./config.ts";
import { catalog, KIND_FOLDERS } from "./models-catalog.ts";
import { getCivitaiModel, getCivitaiKey, civitaiDownloadKind } from "./civitai.ts";
import { reloadTags } from "./tags.ts";
import { bridge } from "./ws-bridge.ts";
import type {
  CivitaiFile,
  CivitaiModelResult,
  CivitaiVersion,
  DownloadJob,
  ModelKind,
  StarterModel,
} from "@latent/shared";

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
  async start(modelId: number, versionId: number, notice?: string): Promise<DownloadJob> {
    const model = await getCivitaiModel(modelId);
    if (!model) throw new Error("Model not found on Civitai");
    const version = model.versions.find((v) => v.id === versionId) ?? model.versions[0];
    if (!version) throw new Error("No version to download");
    const file = version.files.find((f) => f.primary) ?? version.files[0];
    if (!file?.name) throw new Error("No downloadable file for this version");
    assertSafeFilename(file.name);
    const kind = civitaiDownloadKind(model.type, version.baseModel);
    if (!kind) throw new Error(`Unsupported model type: ${model.type || "unknown"}`);

    const job = newJob({ name: file.name, kind, total: file.sizeKB * 1024 });
    void run(job, model, version, file, notice);
    return pub(job);
  },

  /** Download a server-curated non-Civitai starter model. */
  startStarter(model: StarterModel): DownloadJob {
    if (model.source.type !== "url") throw new Error("Starter model does not use a URL source");
    assertHttpsUrl(model.source.url);
    assertSafeFilename(model.filename);
    safeModelDir(model.folder);
    // A pack-level button and an individual tile can be clicked close together.
    // Reuse the active transfer instead of letting two writers corrupt the same
    // resumable `.part` file.
    const active = [...jobs.values()].find(
      (job) => job.status === "downloading" && job.name === model.label,
    );
    if (active) return pub(active);
    const job = newJob({
      name: model.label,
      kind: model.kind ?? "other",
      total: model.sizeBytes ?? 0,
    });
    void runStarter(job, model);
    return pub(job);
  },

  /** Download the tag-autocomplete CSV to config.tagsCsv, then refresh the tag cache. */
  startTags(url: string): DownloadJob {
    const job = newJob({ name: "Tag autocomplete data", kind: "other", total: 0 });
    void runTags(job, url);
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
  expectedBytes?: number,
  expectedSha256?: string,
): Promise<void> {
  assertHttpsUrl(url);
  assertSafeFilename(filename);
  await mkdir(dir, { recursive: true });
  const finalPath = join(dir, filename);
  const partPath = `${finalPath}.part`;
  const existing = await stat(finalPath).catch(() => null);
  if (existing) {
    if (expectedBytes && existing.size === expectedBytes) {
      if (expectedSha256) await assertSha256(finalPath, expectedSha256);
      job.received = existing.size;
      job.total = existing.size;
      return;
    }
    throw new Error(`Refusing to overwrite existing file: ${filename}`);
  }

  let offset = (await stat(partPath).catch(() => null))?.size ?? 0;
  await assertDiskSpace(dir, Math.max(0, (expectedBytes ?? job.total) - offset));
  const request = (resumeAt: number) => fetch(url, {
    signal: job.controller.signal,
    redirect: "follow",
    headers: { ...headers, ...(resumeAt > 0 ? { range: `bytes=${resumeAt}-` } : {}) },
  });
  let res = await request(offset);
  if (offset > 0 && res.status === 416) {
    // A crash can leave a complete .part just before rename. Without a known
    // total, safely restart rather than retrying an unsatisfiable range forever.
    await unlink(partPath).catch(() => {});
    offset = 0;
    res = await request(0);
  }
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  if (offset > 0 && res.status !== 206) offset = 0; // origin does not support resume; restart safely
  const responseBytes = Number(res.headers.get("content-length")) || 0;
  job.received = offset;
  job.total = expectedBytes || (responseBytes ? offset + responseBytes : job.total);

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
  await pipeline(body, createWriteStream(partPath, { flags: offset > 0 ? "a" : "w" }));
  const saved = await stat(partPath);
  const advertised = responseBytes ? offset + responseBytes : 0;
  if (advertised && saved.size !== advertised) {
    throw new Error(`Incomplete download: expected ${advertised} bytes, received ${saved.size}`);
  }
  if (expectedBytes && saved.size !== expectedBytes) {
    throw new Error(`Size mismatch: expected ${expectedBytes} bytes, received ${saved.size}`);
  }
  if (expectedSha256) {
    try {
      await assertSha256(partPath, expectedSha256);
    } catch (err) {
      await unlink(partPath).catch(() => {});
      throw err;
    }
  }
  await rename(partPath, finalPath);
}

function assertHttpsUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid download URL");
  }
  if (url.protocol !== "https:") throw new Error("Downloads must use HTTPS");
}

function assertSafeFilename(filename: string): void {
  if (
    !filename ||
    filename !== basename(filename) ||
    filename === "." ||
    filename === ".." ||
    filename.includes("\0")
  ) {
    throw new Error("Unsafe download filename");
  }
}

function safeModelDir(folder: string): string {
  const root = resolve(config.smModelsDir);
  const target = resolve(root, folder);
  const rel = relative(root, target);
  if (!rel || (!rel.startsWith("..") && !isAbsolute(rel))) return target;
  throw new Error("Unsafe model destination");
}

async function assertDiskSpace(dir: string, remainingBytes: number): Promise<void> {
  if (!remainingBytes) return;
  const info = await statfs(dir);
  const available = Number(info.bavail) * Number(info.bsize);
  const reserve = 256 * 1024 * 1024;
  if (available < remainingBytes + reserve) {
    throw new Error(
      `Not enough disk space: ${(remainingBytes / 1_073_741_824).toFixed(1)} GB needed`,
    );
  }
}

async function assertSha256(path: string, expected: string): Promise<void> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  const actual = hash.digest("hex");
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error("SHA-256 checksum mismatch");
}

/** Finalize a job. Canceled partials are removed; failed transfers remain resumable. */
async function finish(job: Job, dir: string, filename: string, err?: unknown): Promise<void> {
  if (!err) {
    job.status = "completed";
    if (job.total) job.received = job.total;
  } else {
    job.status = job.controller.signal.aborted ? "canceled" : "failed";
    if (job.status === "canceled") await unlink(join(dir, `${filename}.part`)).catch(() => {});
    if (job.status === "failed") job.error = err instanceof Error ? err.message : String(err);
  }
  emit(job);
}

async function run(
  job: Job,
  model: CivitaiModelResult,
  version: CivitaiVersion,
  file: CivitaiFile,
  notice?: string,
): Promise<void> {
  const folder = job.kind !== "other" ? (KIND_FOLDERS[job.kind][0] ?? "") : "";
  const dir = safeModelDir(folder);
  try {
    let url = file.downloadUrl;
    const key = getCivitaiKey();
    if (key && !/[?&]token=/.test(url)) url += `${url.includes("?") ? "&" : "?"}token=${key}`;
    await streamTo(
      job,
      url,
      dir,
      file.name,
      undefined,
      Math.round(file.sizeKB * 1024),
      file.sha256,
    );
  } catch (err) {
    // Civitai 401/403 almost always means "NSFW/gated model, no (valid) API key" —
    // say so plainly instead of surfacing a bare status code.
    if (err instanceof Error && /Download failed \((401|403)\)/.test(err.message)) {
      await finish(
        job,
        dir,
        file.name,
        new Error(
          `Civitai refused the download (${err.message.match(/\((401|403)\)/)?.[1]}). This model needs a free Civitai API key — add it in Settings (or the first-run setup), then retry. If you already added one, check it's correct.`,
        ),
      );
      return;
    }
    await finish(job, dir, file.name, err);
    return;
  }
  await writeSidecars(dir, file.name, model, version).catch((err) => {
    console.warn("[downloads] model sidecar write failed", file.name, err);
  });
  if (notice) {
    try {
      await writeFile(join(dir, "KREA-2-NOTICE.txt"), notice, "utf8");
    } catch (err) {
      await finish(job, dir, file.name, err);
      return;
    }
  }
  if (job.kind !== "other") {
    await catalog.list(job.kind, true).catch((err) => {
      console.warn("[downloads] model catalog refresh failed", file.name, err);
    });
  }
  await finish(job, dir, file.name);
}

async function runTags(job: Job, url: string): Promise<void> {
  const dir = dirname(config.tagsCsv);
  const filename = basename(config.tagsCsv);
  try {
    await streamTo(job, url, dir, filename);
    reloadTags(); // the file changed — drop the (empty) tag cache so autocomplete works now
    await finish(job, dir, filename);
  } catch (err) {
    await finish(job, dir, filename, err);
  }
}

async function runStarter(job: Job, model: StarterModel): Promise<void> {
  if (model.source.type !== "url") return;
  const dir = safeModelDir(model.folder);
  try {
    await streamTo(
      job,
      model.source.url,
      dir,
      model.filename,
      model.source.headers,
      model.sizeBytes,
      model.sha256,
    );
    if (model.license?.notice) {
      await writeFile(join(dir, "KREA-2-NOTICE.txt"), model.license.notice, "utf8");
    }
    if (model.kind) await catalog.list(model.kind, true);
    await finish(job, dir, model.filename);
  } catch (err) {
    await finish(job, dir, model.filename, err);
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
