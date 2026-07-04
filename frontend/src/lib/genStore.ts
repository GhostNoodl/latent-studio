import { create } from "zustand";
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
  values: (pipelineId: string) => Record<string, ParamValue>;
  setSeedMode: (mode: SeedMode) => void;
  setBatch: (n: number) => void;
}

export const useGen = create<GenStore>((set, get) => ({
  valuesByPipeline: {},
  seedMode: "random",
  batch: 1,

  hydrate: (manifest) => {
    if (get().valuesByPipeline[manifest.id]) return;
    const initial: Record<string, ParamValue> = {};
    for (const spec of manifest.params) {
      initial[spec.key] = spec.default ?? defaultFor(spec.control);
    }
    set((s) => ({
      valuesByPipeline: { ...s.valuesByPipeline, [manifest.id]: initial },
    }));
  },

  setValue: (pipelineId, key, value) =>
    set((s) => ({
      valuesByPipeline: {
        ...s.valuesByPipeline,
        [pipelineId]: { ...s.valuesByPipeline[pipelineId], [key]: value },
      },
    })),

  values: (pipelineId) => get().valuesByPipeline[pipelineId] ?? {},
  setSeedMode: (seedMode) => set({ seedMode }),
  setBatch: (batch) => set({ batch: Math.max(1, Math.min(batch, 64)) }),
}));

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
