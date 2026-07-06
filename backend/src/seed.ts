import { existsSync, readFileSync, readdirSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { workflows, settings } from "./db.ts";
import { comfy } from "./comfy.ts";
import { config } from "./config.ts";
import { buildManifestParams } from "./manifest-builder.ts";
import type { ComfyWorkflow, WorkflowManifest } from "@latent/shared";

/**
 * First-run seeding: import the bundled default pipelines (API-format ComfyUI
 * workflows shipped in `workflows/`) so a fresh install has working pipelines.
 * Needs ComfyUI up (params are derived from /object_info). Idempotent — no-op
 * once any pipeline exists.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const workflowsDir = join(repoRoot, "workflows");
const bundledWildcardsDir = join(repoRoot, "wildcards");

const DEFAULTS: {
  name: string;
  type: "image" | "video";
  file: string;
  baseGroup: string;
  mode: string;
  order: number;
}[] = [
  { name: "Illustrious — Smooth v4", type: "image", file: "Smooth Workflow v.4 API.json", baseGroup: "Illustrious", mode: "txt2img", order: 0 },
  { name: "Illustrious — img2img", type: "image", file: "Img2Img (Illustrious) API.json", baseGroup: "Illustrious", mode: "img2img", order: 1 },
  { name: "Inpaint (Illustrious)", type: "image", file: "Inpaint (Illustrious) API.json", baseGroup: "Illustrious", mode: "inpaint", order: 2 },
  { name: "WAN 2.2 — I2V / FLF2V", type: "video", file: "DasiwaWan22WorkflowsI2VSVI2_fastfidelityCAioV83.json", baseGroup: "WAN 2.2", mode: "video", order: 0 },
];

let seeding = false;

// We record the content hash of each bundled workflow the last time we seeded it.
// A mismatch means the bundled file changed (e.g. after an update) → re-import that
// pipeline IN PLACE so users pick up new nodes/toggles without losing their settings.
function seededHashes(): Record<string, string> {
  try {
    return JSON.parse(settings.get("seededPipelineHashes") ?? "{}");
  } catch {
    return {};
  }
}
function setSeededHash(name: string, hash: string): void {
  const m = seededHashes();
  m[name] = hash;
  settings.set("seededPipelineHashes", JSON.stringify(m));
}

/**
 * Sync the bundled default pipelines into the DB: import any that are missing, and
 * migrate any whose bundled workflow has changed since it was seeded (matched by name,
 * updated in place so the id — and therefore the user's saved values — survive). A
 * user-edited pipeline is left alone until the *bundled* file itself changes. Returns
 * the number imported/updated.
 */
export async function seedDefaultPipelines(): Promise<number> {
  if (seeding) return 0;
  seeding = true;
  try {
    const objectInfo = await comfy.objectInfo(); // throws if ComfyUI unreachable
    const byName = new Map(workflows.list().map((w) => [w.name, w]));
    const hashes = seededHashes();
    let changed = 0;
    for (const d of DEFAULTS) {
      const path = join(workflowsDir, d.file);
      if (!existsSync(path)) {
        console.warn(`[seed] bundled workflow missing: ${d.file}`);
        continue;
      }
      const content = readFileSync(path, "utf8");
      const hash = createHash("sha1").update(content).digest("hex");
      const cur = byName.get(d.name);
      if (cur && hashes[d.name] === hash) continue; // present + unchanged since last seed
      try {
        const workflow = JSON.parse(content) as ComfyWorkflow;
        const params = buildManifestParams(workflow, objectInfo);
        const now = new Date().toISOString();
        if (cur) {
          // Migrate in place: keep the id (user's saved values stay), refresh workflow + params.
          workflows.upsert({ ...cur, workflow, params, baseGroup: d.baseGroup, mode: d.mode, order: d.order, updatedAt: now });
          console.log(`[seed] updated "${d.name}" to the latest bundled workflow`);
        } else {
          const manifest: WorkflowManifest = {
            id: nanoid(10),
            name: d.name,
            type: d.type,
            workflow,
            params,
            baseGroup: d.baseGroup,
            mode: d.mode,
            order: d.order,
            createdAt: now,
            updatedAt: now,
          };
          workflows.upsert(manifest);
          console.log(`[seed] imported "${d.name}"`);
        }
        setSeededHash(d.name, hash);
        changed++;
      } catch (err) {
        console.warn(`[seed] failed to import ${d.file}:`, err instanceof Error ? err.message : err);
      }
    }
    if (changed) console.log(`[seed] synced ${changed} default pipeline(s)`);
    return changed;
  } catch {
    return 0; // ComfyUI not ready yet — the onboarding Pipelines step retries
  } finally {
    seeding = false;
  }
}

/**
 * Copy the bundled starter wildcards (`wildcards/*.txt`) into the live wildcards
 * dir on first run so a fresh install has a prompt library out of the box. Only
 * seeds when the live dir has no `.txt` files, so it never clobbers a user's own
 * edits/deletions. No ComfyUI needed. Returns count copied.
 */
export function seedWildcards(): number {
  try {
    if (!existsSync(bundledWildcardsDir)) return 0;
    const bundled = readdirSync(bundledWildcardsDir).filter((f) => f.toLowerCase().endsWith(".txt"));
    if (bundled.length === 0) return 0;

    mkdirSync(config.wildcardsDir, { recursive: true });
    const existing = readdirSync(config.wildcardsDir).filter((f) => f.toLowerCase().endsWith(".txt"));
    if (existing.length > 0) return 0; // user already has wildcards — leave them alone

    let copied = 0;
    for (const file of bundled) {
      copyFileSync(join(bundledWildcardsDir, file), join(config.wildcardsDir, file));
      copied++;
    }
    if (copied) console.log(`[seed] installed ${copied} starter wildcard file(s)`);
    return copied;
  } catch (err) {
    console.warn("[seed] wildcard seeding failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}
