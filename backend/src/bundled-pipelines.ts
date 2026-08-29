import type { ModelKind, WorkflowManifest } from "@latent/shared";

export interface BundledPipeline {
  name: string;
  type: WorkflowManifest["type"];
  file: string;
  baseGroup: string;
  mode: string;
  order: number;
  /** Compatible pinned models to expose even before ComfyUI can discover them. */
  modelOptions?: Partial<Record<ModelKind, string[]>>;
}

/** Pure metadata for the API-format workflows Latent synchronizes into SQLite. */
export const BUNDLED_PIPELINES: BundledPipeline[] = [
  { name: "Image — Smooth v4", type: "image", file: "Smooth Workflow v.4 API.json", baseGroup: "Image", mode: "txt2img", order: 0 },
  { name: "Image — img2img", type: "image", file: "Img2Img (Illustrious) API.json", baseGroup: "Image", mode: "img2img", order: 1 },
  { name: "Inpaint (Image)", type: "image", file: "Inpaint (Illustrious) API.json", baseGroup: "Image", mode: "inpaint", order: 2 },
  {
    name: "Krea 2 — txt2img (Turbo FP8)",
    type: "image",
    file: "Krea 2 Turbo T2I API.json",
    baseGroup: "Krea 2",
    mode: "txt2img",
    order: 0,
    modelOptions: {
      diffusion: ["homofidelisKrea2NSFW_v10TURBOINT8Convrot.safetensors"],
    },
  },
  { name: "LTX 2.3 — img2vid (Sulphur)", type: "video", file: "LTX 2.3 I2V API.json", baseGroup: "LTX 2.3", mode: "i2v", order: 0 },
  { name: "MiniMax H3 — txt2vid", type: "video", file: "MiniMax H3 T2V API.json", baseGroup: "MiniMax H3", mode: "t2v", order: 0 },
  { name: "MiniMax H3 — img2vid", type: "video", file: "MiniMax H3 I2V API.json", baseGroup: "MiniMax H3", mode: "i2v", order: 1 },
  { name: "MiniMax Music 3 — text to music", type: "audio", file: "MiniMax Music 3 T2M API.json", baseGroup: "MiniMax Music 3", mode: "t2m", order: 0 },
];
