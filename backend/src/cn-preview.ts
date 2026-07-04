import { comfy } from "./comfy.ts";
import { bridge } from "./ws-bridge.ts";
import type { ComfyWorkflow } from "@latent/shared";

/**
 * Run just a ControlNet preprocessor over a source image and return the control
 * map PNG (canny edges, depth map, pose skeleton, …) so the UI can preview what
 * will guide the generation before committing to a full run. Queued untracked,
 * so it never lands in the gallery. Mirrors the auto-mask detection pattern.
 */
interface HistoryEntry {
  outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
  status?: { status_str?: string };
}

export async function runCnPreview(
  imageName: string,
  preprocessor: string,
  resolution = 512,
): Promise<Buffer> {
  const graph = {
    "1": { class_type: "LoadImage", inputs: { image: imageName }, _meta: { title: "src" } },
    "2": {
      class_type: "AIO_Preprocessor",
      inputs: { image: ["1", 0], preprocessor, resolution },
      _meta: { title: "preprocess" },
    },
    "3": { class_type: "PreviewImage", inputs: { images: ["2", 0] }, _meta: { title: "out" } },
  } as unknown as ComfyWorkflow;

  const promptId = await comfy.queuePrompt(graph, bridge.clientId);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const hist = (await comfy.history(promptId)) as Record<string, HistoryEntry>;
    const entry = hist[promptId];
    if (!entry) continue;
    if (entry.status?.status_str === "error") throw new Error("Preprocessor failed in ComfyUI");
    if (entry.outputs) {
      for (const out of Object.values(entry.outputs)) {
        const img = out.images?.[0];
        if (img) {
          const { buffer } = await comfy.view({
            filename: img.filename,
            subfolder: img.subfolder,
            type: (img.type as "output" | "temp") ?? "temp",
          });
          return buffer;
        }
      }
    }
  }
  throw new Error("ControlNet preview timed out");
}
