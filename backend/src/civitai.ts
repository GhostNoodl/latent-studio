import { settings } from "./db.ts";
import type {
  CivitaiModelResult,
  CivitaiSearchResult,
  ModelInfo,
  ModelKind,
} from "@latent/shared";

/**
 * Civitai integration: on-demand enrichment for local models, plus search +
 * detail for the in-app model browser. Public API — no auth needed for search;
 * an optional CIVITAI_API_KEY unlocks gated content.
 */

interface RawImage {
  url?: string;
  type?: string;
  nsfwLevel?: number;
  width?: number;
  height?: number;
}
interface RawFile {
  name?: string;
  sizeKB?: number;
  primary?: boolean;
  downloadUrl?: string;
  metadata?: { format?: string };
  hashes?: { SHA256?: string };
}
interface CivitaiVersion {
  id?: number;
  name?: string;
  baseModel?: string;
  trainedWords?: string[];
  images?: RawImage[];
  files?: RawFile[];
}
interface CivitaiModel {
  id?: number;
  name?: string;
  type?: string;
  nsfw?: boolean;
  description?: string;
  tags?: string[];
  creator?: { username?: string; image?: string };
  stats?: { downloadCount?: number; thumbsUpCount?: number; rating?: number; favoriteCount?: number };
  modelVersions?: CivitaiVersion[];
}

/** Strip quant/precision/version noise from a filename for a better search hit. */
export function civitaiQuery(file: string): string {
  return file
    .replace(/\.[^.]+$/, "")
    .replace(/\b(fp8|fp16|fp32|bf16|q\d[_a-z0-9]*|gguf|scaled|pruned|ema-?only|ema)\b/gi, " ")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Our model kinds → Civitai `types` filter (so we don't match Workflows/etc.).
const KIND_TO_CIVITAI_TYPE: Partial<Record<ModelKind, string>> = {
  checkpoint: "Checkpoint",
  diffusion: "Checkpoint",
  lora: "LORA",
  vae: "VAE",
  upscale: "Upscaler",
  controlnet: "Controlnet",
  embedding: "TextualInversion",
};

/** Civitai type → our kind (for routing a download into the right SM folder). */
export const CIVITAI_TYPE_TO_KIND: Record<string, ModelKind> = {
  Checkpoint: "checkpoint",
  LORA: "lora",
  LoCon: "lora",
  DoRA: "lora",
  VAE: "vae",
  Upscaler: "upscale",
  Controlnet: "controlnet",
  TextualInversion: "embedding",
};

/** Civitai API key — a user-set value (Settings) wins over the env fallback. */
export function getCivitaiKey(): string | undefined {
  return settings.get("civitaiApiKey") || process.env.CIVITAI_API_KEY || undefined;
}

function authHeaders(): Record<string, string> {
  const key = getCivitaiKey();
  return key ? { authorization: `Bearer ${key}` } : {};
}

/** Normalize a raw Civitai model into the shape the app/UI consume. */
function mapModel(item: CivitaiModel): CivitaiModelResult {
  const versions = (item.modelVersions ?? []).map((v) => ({
    id: v.id ?? 0,
    name: v.name ?? "",
    baseModel: v.baseModel,
    trainedWords: v.trainedWords ?? [],
    images: (v.images ?? [])
      .filter((i) => i.url)
      .map((i) => ({
        url: i.url!,
        type: i.type === "video" ? ("video" as const) : ("image" as const),
        nsfwLevel: i.nsfwLevel ?? 0,
        width: i.width,
        height: i.height,
      })),
    files: (v.files ?? []).map((f) => ({
      name: f.name ?? "",
      sizeKB: f.sizeKB ?? 0,
      format: f.metadata?.format,
      primary: Boolean(f.primary),
      downloadUrl: f.downloadUrl ?? `https://civitai.com/api/download/models/${v.id ?? 0}`,
      sha256: f.hashes?.SHA256,
    })),
  }));
  return {
    id: item.id ?? 0,
    name: item.name ?? "",
    type: item.type ?? "",
    nsfw: Boolean(item.nsfw),
    author: item.creator?.username,
    authorImage: item.creator?.image,
    description: item.description,
    tags: item.tags ?? [],
    stats: {
      downloadCount: item.stats?.downloadCount,
      thumbsUpCount: item.stats?.thumbsUpCount,
      rating: item.stats?.rating,
      favoriteCount: item.stats?.favoriteCount,
    },
    versions,
    // Prefer a still image for the cover (many models lead with an mp4 preview that
    // can't render in an <img>); fall back to whatever the first media is.
    cover:
      versions.flatMap((v) => v.images).find((i) => i.type === "image")?.url ??
      versions.find((v) => v.images[0])?.images[0]?.url,
  };
}

/** Search/browse Civitai models for the in-app browser. */
export async function searchCivitai(params: {
  query?: string;
  kind?: ModelKind;
  sort?: string;
  period?: string;
  baseModels?: string[];
  tag?: string;
  username?: string;
  nsfw?: boolean;
  cursor?: string;
  limit?: number;
}): Promise<CivitaiSearchResult> {
  const qs = new URLSearchParams();
  if (params.query) qs.set("query", params.query);
  if (params.username) qs.set("username", params.username);
  const type = params.kind ? KIND_TO_CIVITAI_TYPE[params.kind] : undefined;
  if (type) qs.set("types", type);
  qs.set("sort", params.sort ?? "Most Downloaded");
  if (params.period) qs.set("period", params.period);
  for (const bm of params.baseModels ?? []) qs.append("baseModels", bm);
  if (params.tag) qs.set("tag", params.tag);
  qs.set("nsfw", String(params.nsfw ?? true));
  qs.set("limit", String(params.limit ?? 24));
  if (params.cursor) qs.set("cursor", params.cursor);

  const res = await fetch(`https://civitai.com/api/v1/models?${qs.toString()}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Civitai search ${res.status}`);
  const json = (await res.json()) as { items?: CivitaiModel[]; metadata?: { nextCursor?: unknown } };
  return {
    items: (json.items ?? []).map(mapModel),
    nextCursor: json.metadata?.nextCursor != null ? String(json.metadata.nextCursor) : undefined,
  };
}

/** Full detail for a single model (fresh files/versions for download). */
export async function getCivitaiModel(id: number): Promise<CivitaiModelResult | null> {
  const res = await fetch(`https://civitai.com/api/v1/models/${id}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  return mapModel((await res.json()) as CivitaiModel);
}

export async function enrichFromCivitai(
  query: string,
  kind?: ModelKind,
): Promise<Partial<ModelInfo> | null> {
  const type = kind ? KIND_TO_CIVITAI_TYPE[kind] : undefined;
  const typeParam = type ? `&types=${type}` : "";
  const url = `https://civitai.com/api/v1/models?query=${encodeURIComponent(query)}&limit=5&nsfw=true${typeParam}`;
  const headers: Record<string, string> = {};
  if (process.env.CIVITAI_API_KEY) headers.authorization = `Bearer ${process.env.CIVITAI_API_KEY}`;

  let json: { items?: CivitaiModel[] };
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    json = (await res.json()) as { items?: CivitaiModel[] };
  } catch {
    return null;
  }

  const item = json.items?.[0];
  if (!item) return null;

  const version = item.modelVersions?.[0] ?? {};
  const allImages = item.modelVersions?.flatMap((v) => v.images ?? []) ?? [];
  const previewUrl =
    allImages.find((i) => i.url && i.type !== "video")?.url ?? allImages.find((i) => i.url)?.url;

  return {
    name: item.name ?? query,
    versionName: version.name,
    baseModel: version.baseModel,
    modelType: item.type,
    author: item.creator?.username,
    trainedWords: version.trainedWords ?? [],
    tags: item.tags ?? [],
    nsfw: item.nsfw,
    civitaiModelId: item.id,
    civitaiVersionId: version.id,
    stats: {
      downloadCount: item.stats?.downloadCount,
      thumbsUpCount: item.stats?.thumbsUpCount,
      rating: item.stats?.rating,
    },
    previewUrl,
  };
}
