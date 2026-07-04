import { comfy } from "./comfy.ts";
import { bridge } from "./ws-bridge.ts";
import type { ComfyWorkflow } from "@latent/shared";

/**
 * Smart auto-masking: run a one-off ComfyUI detection graph over a source image
 * and return the resulting black/white mask PNG (white = detected regions).
 * Uses Impact-Pack's Ultralytics yolo detector → SEGS → combined mask. The graph
 * is queued but not tracked, so it never lands in the gallery.
 */

const DETECTORS: Record<string, string> = {
  face: "bbox/face_yolov8m.pt",
  hand: "bbox/hand_yolov8s.pt",
  person: "segm/person_yolov8m-seg.pt",
};

function detectionGraph(imageName: string, modelName: string): ComfyWorkflow {
  return {
    "1": { class_type: "LoadImage", inputs: { image: imageName }, _meta: { title: "src" } },
    "2": {
      class_type: "UltralyticsDetectorProvider",
      inputs: { model_name: modelName },
      _meta: { title: "detector" },
    },
    "3": {
      class_type: "BboxDetectorSEGS",
      inputs: {
        bbox_detector: ["2", 0],
        image: ["1", 0],
        threshold: 0.5,
        dilation: 10,
        crop_factor: 3.0,
        drop_size: 10,
        labels: "all",
      },
      _meta: { title: "detect" },
    },
    "4": { class_type: "SegsToCombinedMask", inputs: { segs: ["3", 0] }, _meta: { title: "mask" } },
    "5": { class_type: "MaskToImage", inputs: { mask: ["4", 0] }, _meta: { title: "toimage" } },
    "6": { class_type: "PreviewImage", inputs: { images: ["5", 0] }, _meta: { title: "out" } },
  } as unknown as ComfyWorkflow;
}

interface HistoryEntry {
  outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
  status?: { status_str?: string; completed?: boolean };
}

/** Run detection and return the combined-mask PNG bytes. */
export async function runAutoMask(imageName: string, detector = "face"): Promise<Buffer> {
  const modelName = DETECTORS[detector] ?? DETECTORS.face!;
  const graph = detectionGraph(imageName, modelName);
  const promptId = await comfy.queuePrompt(graph, bridge.clientId);

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const hist = (await comfy.history(promptId)) as Record<string, HistoryEntry>;
    const entry = hist[promptId];
    if (!entry) continue;
    if (entry.status?.status_str === "error") throw new Error("Detection failed in ComfyUI");
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
  throw new Error("Auto-mask timed out");
}
