import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ParamValue, WorkflowManifest } from "@latent/shared";

export type SeedMode = "fixed" | "random" | "increment";

interface GenStore {
  /** Param values per pipeline id, keyed by ParamSpec.key. */
  valuesByPipeline: Record<string, Record<string, ParamValue>>;
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

export const useGen = create<GenStore>()(
  persist(
    (set, get) => ({
      valuesByPipeline: {},
      seedMode: "random",
      batch: 1,

      hydrate: (manifest) => {
        if (hydratedThisSession.has(manifest.id)) return;
        hydratedThisSession.add(manifest.id);
        // `prev` is whatever persisted from the last session (localStorage).
        const prev = get().valuesByPipeline[manifest.id];
        const next: Record<string, ParamValue> = {};
        for (const spec of manifest.params) {
          // Prompts start fresh every session; every other setting is remembered.
          const saved = prev?.[spec.key];
          if (spec.control === "textarea") {
            next[spec.key] = spec.default ?? "";
          } else {
            next[spec.key] = saved !== undefined ? saved : (spec.default ?? defaultFor(spec.control));
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
        })),

      applyValues: (pipelineId, values) =>
        set((s) => ({
          valuesByPipeline: {
            ...s.valuesByPipeline,
            [pipelineId]: { ...s.valuesByPipeline[pipelineId], ...values },
          },
        })),

      values: (pipelineId) => get().valuesByPipeline[pipelineId] ?? {},
      setSeedMode: (seedMode) => set({ seedMode }),
      setBatch: (batch) => set({ batch: Math.max(1, Math.min(batch, 64)) }),
    }),
    {
      name: "latent-gen-values",
      // Persist only the data, never the actions.
      partialize: (s) => ({ valuesByPipeline: s.valuesByPipeline, seedMode: s.seedMode, batch: s.batch }),
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
