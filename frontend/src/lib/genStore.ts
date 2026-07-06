import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ParamValue, WorkflowManifest } from "@latent/shared";

export type SeedMode = "fixed" | "random" | "increment";

interface GenStore {
  /** Param values per pipeline id, keyed by ParamSpec.key. */
  valuesByPipeline: Record<string, Record<string, ParamValue>>;
  /** Keys the user has explicitly set (per pipeline). Untouched params follow the
   * manifest's current default, so improved defaults still reach existing users. */
  touchedByPipeline: Record<string, string[]>;
  seedMode: SeedMode;
  batch: number;

  /** Seed defaults from the manifest the first time a pipeline is opened. */
  hydrate: (manifest: WorkflowManifest) => void;
  setValue: (pipelineId: string, key: string, value: ParamValue) => void;
  /** Apply a whole set of values at once (e.g. reusing a past generation's settings). */
  applyValues: (pipelineId: string, values: Record<string, ParamValue>) => void;
  values: (pipelineId: string) => Record<string, ParamValue>;
  setSeedMode: (mode: SeedMode) => void;
  setBatch: (n: number) => void;
}

// Pipelines already initialized THIS session — module-level (NOT persisted) so it
// resets on reload. That's how prompts get cleared once per session but not on every
// tab navigation (which re-calls hydrate).
const hydratedThisSession = new Set<string>();

function withKeys(list: string[] | undefined, add: string[]): string[] {
  return Array.from(new Set([...(list ?? []), ...add]));
}

export const useGen = create<GenStore>()(
  persist(
    (set, get) => ({
      valuesByPipeline: {},
      touchedByPipeline: {},
      seedMode: "random",
      batch: 1,

      hydrate: (manifest) => {
        if (hydratedThisSession.has(manifest.id)) return;
        hydratedThisSession.add(manifest.id);
        const saved = get().valuesByPipeline[manifest.id] ?? {};
        const touched = new Set(get().touchedByPipeline[manifest.id] ?? []);
        const next: Record<string, ParamValue> = {};
        for (const spec of manifest.params) {
          const savedVal = saved[spec.key];
          if (spec.control === "textarea") {
            // Prompts start fresh every session.
            next[spec.key] = spec.default ?? "";
          } else if (touched.has(spec.key) && savedVal !== undefined) {
            // The user picked this — remember it.
            next[spec.key] = savedVal;
          } else {
            // Untouched — follow the manifest's current default (so default changes apply).
            next[spec.key] = spec.default ?? defaultFor(spec.control);
          }
        }
        set((s) => ({ valuesByPipeline: { ...s.valuesByPipeline, [manifest.id]: next } }));
      },

      setValue: (pipelineId, key, value) =>
        set((s) => ({
          valuesByPipeline: {
            ...s.valuesByPipeline,
            [pipelineId]: { ...s.valuesByPipeline[pipelineId], [key]: value },
          },
          touchedByPipeline: {
            ...s.touchedByPipeline,
            [pipelineId]: withKeys(s.touchedByPipeline[pipelineId], [key]),
          },
        })),

      applyValues: (pipelineId, values) =>
        set((s) => ({
          valuesByPipeline: {
            ...s.valuesByPipeline,
            [pipelineId]: { ...s.valuesByPipeline[pipelineId], ...values },
          },
          touchedByPipeline: {
            ...s.touchedByPipeline,
            [pipelineId]: withKeys(s.touchedByPipeline[pipelineId], Object.keys(values)),
          },
        })),

      values: (pipelineId) => get().valuesByPipeline[pipelineId] ?? {},
      setSeedMode: (seedMode) => set({ seedMode }),
      setBatch: (batch) => set({ batch: Math.max(1, Math.min(batch, 64)) }),
    }),
    {
      name: "latent-gen-values",
      version: 1,
      // Persist only the data, never the actions.
      partialize: (s) => ({
        valuesByPipeline: s.valuesByPipeline,
        touchedByPipeline: s.touchedByPipeline,
        seedMode: s.seedMode,
        batch: s.batch,
      }),
      migrate: (persisted: any, version) => {
        // v0 locked in ALL defaults. Treat the user's non-toggle values as chosen (keep
        // them) but let feature on/off toggles re-derive from current defaults, so improved
        // defaults (e.g. FaceDetailer now off) reach existing users.
        if (version < 1 && persisted?.valuesByPipeline) {
          const touched: Record<string, string[]> = {};
          for (const [pid, vals] of Object.entries(persisted.valuesByPipeline)) {
            touched[pid] = Object.keys(vals as object).filter((k) => !k.endsWith(".__enabled"));
          }
          persisted.touchedByPipeline = touched;
        }
        return persisted;
      },
    },
  ),
);

function defaultFor(control: string): ParamValue {
  switch (control) {
    case "toggle":
      return false;
    case "loras":
      return [];
    case "slider":
    case "number":
    case "seed":
      return 0;
    default:
      return "";
  }
}
