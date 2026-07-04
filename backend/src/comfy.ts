import { config } from "./config.ts";
import type { ComfyWorkflow, ObjectInfo } from "@latent/shared";

/** Thin client over the ComfyUI HTTP API. */

let objectInfoCache: { data: ObjectInfo; fetchedAt: number } | null = null;
const OBJECT_INFO_TTL_MS = 60_000;

export interface ViewParams {
  filename: string;
  subfolder?: string;
  type?: "output" | "input" | "temp";
}

async function comfyFetch(path: string, init?: RequestInit): Promise<Response> {
  // Guard against a hung ComfyUI stalling handlers / the WS finalize queue.
  const res = await fetch(`${config.comfyUrl}${path}`, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ComfyUI ${path} -> ${res.status} ${res.statusText} ${body}`.trim());
  }
  return res;
}

export const comfy = {
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${config.comfyUrl}/system_stats`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async objectInfo(force = false): Promise<ObjectInfo> {
    const fresh =
      objectInfoCache !== null && Date.now() - objectInfoCache.fetchedAt < OBJECT_INFO_TTL_MS;
    if (fresh && !force) return objectInfoCache!.data;
    const res = await comfyFetch("/object_info");
    const data = (await res.json()) as ObjectInfo;
    objectInfoCache = { data, fetchedAt: Date.now() };
    return data;
  },

  isObjectInfoCached(): boolean {
    return objectInfoCache !== null;
  },

  /** Enqueue a workflow. Returns ComfyUI's prompt_id. */
  async queuePrompt(workflow: ComfyWorkflow, clientId: string): Promise<string> {
    const res = await comfyFetch("/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    });
    const json = (await res.json()) as { prompt_id: string };
    return json.prompt_id;
  },

  async history(promptId: string): Promise<unknown> {
    const res = await comfyFetch(`/history/${promptId}`);
    return res.json();
  },

  async view(params: ViewParams): Promise<{ buffer: Buffer; contentType: string }> {
    const qs = new URLSearchParams({
      filename: params.filename,
      subfolder: params.subfolder ?? "",
      type: params.type ?? "output",
    });
    const res = await comfyFetch(`/view?${qs.toString()}`);
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, contentType };
  },

  async uploadImage(
    filename: string,
    data: Buffer,
    contentType: string,
  ): Promise<{ name: string; subfolder: string; type: string }> {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(data)], { type: contentType });
    form.append("image", blob, filename);
    form.append("overwrite", "true");
    const res = await comfyFetch("/upload/image", { method: "POST", body: form });
    return res.json() as Promise<{ name: string; subfolder: string; type: string }>;
  },

  async interrupt(): Promise<void> {
    await comfyFetch("/interrupt", { method: "POST" });
  },

  /** ComfyUI queue snapshot. Each entry is [num, promptId, prompt, extra, outputs]. */
  async queue(): Promise<{ queue_running: unknown[][]; queue_pending: unknown[][] }> {
    const res = await comfyFetch("/queue");
    return res.json() as Promise<{ queue_running: unknown[][]; queue_pending: unknown[][] }>;
  },

  /** Remove specific pending prompts from the queue. */
  async deleteQueued(promptIds: string[]): Promise<void> {
    await comfyFetch("/queue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delete: promptIds }),
    });
  },

  /** Clear all pending prompts (does not stop the running one). */
  async clearQueue(): Promise<void> {
    await comfyFetch("/queue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clear: true }),
    });
  },
};
