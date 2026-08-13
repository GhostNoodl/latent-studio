import WebSocket from "ws";
import { createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { nanoid } from "nanoid";
import { config, comfyWsUrl } from "./config.ts";
import { comfy } from "./comfy.ts";
import { generations } from "./db.ts";
import type { OutputAsset, ServerEvent } from "@latent/shared";

/**
 * Maintains a single upstream WebSocket to ComfyUI and fans out translated
 * events to all connected browser clients. Also tracks in-flight generations:
 * maps ComfyUI prompt_ids back to our generation ids, downloads finished
 * outputs into the app's store, and finalizes DB rows.
 */

const VIDEO_EXTS = /\.(mp4|webm|mov|m4v)$/i;

interface PendingGeneration {
  generationId: string;
  assets: OutputAsset[];
  seen: Set<string>;
}

export interface BrowserSink {
  send: (ev: ServerEvent) => void;
  sendPreview: (meta: PreviewMeta, bytes: Buffer) => void;
}

export interface PreviewMeta {
  type: "preview";
  generationId?: string;
  promptId?: string;
  mime: "image/jpeg" | "image/png";
}

class ComfyBridge {
  /** Stable client id used for the backend's own upstream connection. */
  readonly clientId = `latent-${nanoid(8)}`;
  private upstream: WebSocket | null = null;
  private browsers = new Set<BrowserSink>();
  /** promptId -> tracking state */
  private pending = new Map<string, PendingGeneration>();
  /** prompt currently executing (to attribute binary preview frames) */
  private currentPromptId: string | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  /** Connection-state tracking so 2s reconnect attempts don't spam the console. */
  private everConnected = false;
  private announcedDown = false;
  private downAttempts = 0;
  /**
   * Text messages are processed strictly in order: `executed` (which awaits
   * downloading output files) must finish persisting its assets before the
   * trailing `executing: null` finalizes the generation. Without this chain
   * the completion signal can overtake the still-in-flight download.
   */
  private queue: Promise<void> = Promise.resolve();
  private lastPreviewAt = 0;

  connect(): void {
    if (this.upstream) return;
    const ws = new WebSocket(comfyWsUrl(this.clientId));
    this.upstream = ws;

    ws.on("open", () => {
      console.log("[bridge] connected to ComfyUI");
      this.everConnected = true;
      this.announcedDown = false;
      this.downAttempts = 0;
      this.queue = this.queue
        .then(() => this.reconcile())
        .catch((err) => console.warn("[bridge] recovery error:", err));
    });
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        this.onBinaryPreview(data as Buffer);
        return;
      }
      this.queue = this.queue
        .then(() => this.onTextMessage(data))
        .catch((err) => console.warn("[bridge] message error:", err));
    });
    ws.on("close", () => {
      this.upstream = null;
      this.downAttempts++;
      // Announce the outage ONCE (not on every 2s retry), then stay quiet.
      if (!this.announcedDown) {
        console.log(
          this.everConnected
            ? "[bridge] ComfyUI socket closed; reconnecting every 2s…"
            : "[bridge] waiting for ComfyUI to start (retrying every 2s)…",
        );
        this.announcedDown = true;
        this.everConnected = false;
      } else if (this.downAttempts === 30) {
        console.warn("[bridge] ComfyUI still unreachable after ~60s — is it running?");
      }
      this.scheduleReconnect();
    });
    ws.on("error", (err) => {
      // ECONNREFUSED/ECONNRESET are expected while ComfyUI is still booting; the
      // close handler does the throttled logging. Only surface genuine surprises.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ECONNREFUSED" && code !== "ECONNRESET") {
        console.warn("[bridge] ComfyUI socket error:", err.message);
      }
      ws.close();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  /** Register a generation so its prompt_id events get routed + persisted. */
  track(promptId: string, generationId: string): void {
    const existing = this.pending.get(promptId);
    if (existing?.generationId === generationId) return;
    this.pending.set(promptId, { generationId, assets: [], seen: new Set() });
  }

  /** Stop tracking a prompt (e.g. after it's canceled/removed from the queue). */
  drop(promptId: string): void {
    this.pending.delete(promptId);
    if (this.currentPromptId === promptId) this.currentPromptId = null;
  }

  /** Notified with the live browser-client count whenever it changes. */
  onPresence: ((count: number) => void) | null = null;

  addBrowser(sink: BrowserSink): void {
    this.browsers.add(sink);
    this.onPresence?.(this.browsers.size);
  }
  removeBrowser(sink: BrowserSink): void {
    this.browsers.delete(sink);
    this.onPresence?.(this.browsers.size);
  }

  broadcast(ev: ServerEvent): void {
    for (const sink of this.browsers) {
      try {
        sink.send(ev);
      } catch {
        /* drop broken client */
      }
    }
  }

  /** Reattach persisted queued/running rows after a backend or ComfyUI reconnect. */
  private async reconcile(): Promise<void> {
    const records = generations.inFlight();
    if (records.length === 0) return;

    // Only classify jobs as gone after ComfyUI answered both queue and history.
    const snapshot = await comfy.queue();
    const running = new Set(
      (snapshot.queue_running ?? []).map((entry) => String(entry[1] ?? "")).filter(Boolean),
    );
    const queued = new Set(
      (snapshot.queue_pending ?? []).map((entry) => String(entry[1] ?? "")).filter(Boolean),
    );

    for (const record of records) {
      const promptId = record.promptId;
      if (!promptId) {
        const failed = generations.update(record.id, {
          status: "failed",
          error: "Latent restarted before ComfyUI accepted this prompt",
          completedAt: new Date().toISOString(),
        });
        if (failed) this.broadcast({ type: "generation", record: failed });
        continue;
      }

      this.track(promptId, record.id);
      if (running.has(promptId) || queued.has(promptId)) {
        const status = running.has(promptId) ? "running" : "queued";
        if (record.status !== status) {
          const updated = generations.update(record.id, { status });
          if (updated) this.broadcast({ type: "generation", record: updated });
        }
        continue;
      }

      const history = (await comfy.history(promptId)) as Record<
        string,
        { outputs?: Record<string, Record<string, unknown>>; status?: { status_str?: string } }
      >;
      const entry = history?.[promptId];
      if (entry) {
        for (const output of Object.values(entry.outputs ?? {})) {
          await this.collectOutputs(promptId, output);
        }
        await this.finalize(promptId);
        continue;
      }

      this.drop(promptId);
      const canceled = generations.update(record.id, {
        status: "canceled",
        error: "Prompt was not present in the ComfyUI queue or history after reconnect",
        completedAt: new Date().toISOString(),
      });
      if (canceled) this.broadcast({ type: "generation", record: canceled });
    }
  }

  private genIdFor(promptId: string | undefined): string | undefined {
    if (!promptId) return undefined;
    return this.pending.get(promptId)?.generationId;
  }

  private async onTextMessage(data: WebSocket.RawData): Promise<void> {
    let msg: { type: string; data: Record<string, unknown> };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const d = msg.data ?? {};
    const promptId = d.prompt_id as string | undefined;

    switch (msg.type) {
      case "status": {
        const remaining =
          (d.status as { exec_info?: { queue_remaining?: number } })?.exec_info
            ?.queue_remaining ?? 0;
        this.broadcast({ type: "status", queueRemaining: remaining });
        break;
      }
      case "progress": {
        this.broadcast({
          type: "progress",
          generationId: this.genIdFor(promptId),
          promptId,
          value: Number(d.value ?? 0),
          max: Number(d.max ?? 0),
        });
        break;
      }
      case "executing": {
        const node = (d.node as string | null) ?? null;
        if (node !== null && promptId) {
          this.currentPromptId = promptId;
          const pending = this.pending.get(promptId);
          const current = pending ? generations.get(pending.generationId) : undefined;
          if (current?.status === "queued") {
            const running = generations.update(current.id, { status: "running" });
            if (running) this.broadcast({ type: "generation", record: running });
          }
        }
        this.broadcast({
          type: "executing",
          generationId: this.genIdFor(promptId),
          promptId,
          node,
        });
        // node === null signals this prompt finished executing.
        if (node === null && promptId && this.pending.has(promptId)) {
          await this.finalize(promptId);
        }
        break;
      }
      case "executed": {
        if (promptId && this.pending.has(promptId)) {
          await this.collectOutputs(promptId, d.output as Record<string, unknown>);
        }
        break;
      }
      case "execution_error": {
        if (promptId && this.pending.has(promptId)) {
          const message = String(d.exception_message ?? "Execution error");
          const gen = generations.update(this.pending.get(promptId)!.generationId, {
            status: "failed",
            error: message,
            completedAt: new Date().toISOString(),
          });
          this.drop(promptId);
          this.broadcast({ type: "error", generationId: gen?.id, message });
          if (gen) this.broadcast({ type: "generation", record: gen });
        }
        break;
      }
      case "execution_interrupted": {
        // User hit interrupt/cancel — finalize the row as canceled (not failed)
        // and stop tracking so its `pending` entry can't leak.
        if (promptId && this.pending.has(promptId)) {
          const gen = generations.update(this.pending.get(promptId)!.generationId, {
            status: "canceled",
            completedAt: new Date().toISOString(),
          });
          this.drop(promptId);
          if (gen) this.broadcast({ type: "generation", record: gen });
        }
        break;
      }
    }
  }

  private onBinaryPreview(buf: Buffer): void {
    // ComfyUI preview frame: 4-byte event + 4-byte image format, then JPEG/PNG bytes.
    if (buf.length < 8) return;
    const format = buf.readUInt32BE(4);
    const mime = format === 2 ? "image/png" : "image/jpeg";
    const imageBytes = buf.subarray(8);
    const now = Date.now();
    if (now - this.lastPreviewAt < 150) return;
    this.lastPreviewAt = now;
    const generationId = this.genIdFor(this.currentPromptId ?? undefined);
    const meta: PreviewMeta = {
      type: "preview",
      generationId,
      promptId: this.currentPromptId ?? undefined,
      mime,
    };
    for (const sink of this.browsers) {
      try {
        sink.sendPreview(meta, imageBytes);
      } catch {
        /* drop broken client */
      }
    }
  }

  /** Pull every output asset referenced by an `executed` event into our store. */
  private async collectOutputs(promptId: string, output: Record<string, unknown>): Promise<void> {
    const pending = this.pending.get(promptId);
    if (!pending || !output) return;
    // Output keys vary by node: images / gifs / videos. Collect all file refs.
    const refs: { filename: string; subfolder: string; type: string }[] = [];
    for (const value of Object.values(output)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === "object" && "filename" in item) {
            refs.push(item as { filename: string; subfolder: string; type: string });
          }
        }
      }
    }
    await mapConcurrent(refs, 2, async (ref) => this.collectOutput(pending, ref));
  }

  private async collectOutput(
    pending: PendingGeneration,
    ref: { filename: string; subfolder: string; type: string },
  ): Promise<void> {
    let sourceKey: string | undefined;
    let partPath: string | undefined;
    try {
      const sourceName = safeOutputName(ref.filename);
      sourceKey = `${ref.type}\u0000${ref.subfolder}\u0000${sourceName}`;
      if (pending.seen.has(sourceKey)) return;
      pending.seen.add(sourceKey);

      const storedName = `${pending.generationId}-${nanoid(6)}-${sourceName}`;
      const finalPath = join(config.dataDir, "outputs", storedName);
      partPath = `${finalPath}.part`;
      const response = await comfy.viewStream({
        filename: sourceName,
        subfolder: ref.subfolder,
        type: ref.type === "temp" ? "temp" : "output",
      });
      if (!response.body) throw new Error("ComfyUI returned an empty output stream");
      await pipeline(
        Readable.fromWeb(response.body as unknown as NodeWebReadableStream<Uint8Array>),
        createWriteStream(partPath, { flags: "wx" }),
      );
      await rename(partPath, finalPath);
      pending.assets.push({
        url: `/outputs/${encodeURIComponent(storedName)}`,
        type: VIDEO_EXTS.test(sourceName) ? "video" : "image",
        filename: sourceName,
      });
    } catch (err) {
      if (sourceKey) pending.seen.delete(sourceKey);
      if (partPath) await unlink(partPath).catch(() => {});
      console.warn("[bridge] failed to fetch output", ref.filename, err);
    }
  }

  private async finalize(promptId: string): Promise<void> {
    const pending = this.pending.get(promptId);
    if (!pending) return;
    this.pending.delete(promptId);
    if (this.currentPromptId === promptId) this.currentPromptId = null;
    const thumbnail = pending.assets.find((a) => a.type === "image")?.url;
    const gen = generations.update(pending.generationId, {
      status: pending.assets.length > 0 ? "completed" : "failed",
      outputs: pending.assets,
      thumbnail,
      error: pending.assets.length === 0 ? "No outputs produced" : undefined,
      completedAt: new Date().toISOString(),
    });
    if (gen) this.broadcast({ type: "generation", record: gen });
  }
}

export const bridge = new ComfyBridge();

function safeOutputName(value: string): string {
  const name = basename(value);
  if (!name || name !== value || name === "." || name === ".." || name.includes("\0")) {
    throw new Error("Unsafe ComfyUI output filename");
  }
  return name;
}

async function mapConcurrent<T>(
  values: T[],
  concurrency: number,
  fn: (value: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor++;
      await fn(values[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
}
