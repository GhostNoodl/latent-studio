import { create } from "zustand";
import type { LogEntry } from "@latent/shared";

/** Client-side buffer of captured backend + ComfyUI log lines (see the Console). */

const CAP = 4000;

interface LogStore {
  items: LogEntry[];
  /** True once the initial snapshot has been fetched. */
  seeded: boolean;
  seed: (entries: LogEntry[]) => void;
  add: (entry: LogEntry) => void;
  clear: () => void;
}

export const useLogs = create<LogStore>((set) => ({
  items: [],
  seeded: false,
  seed: (entries) => set({ items: entries.slice(-CAP), seeded: true }),
  add: (entry) =>
    set((s) => {
      // Ignore duplicates already present from the seed snapshot.
      if (s.items.length && entry.id <= s.items[s.items.length - 1]!.id) return s;
      const items = [...s.items, entry];
      if (items.length > CAP) items.splice(0, items.length - CAP);
      return { items };
    }),
  clear: () => set({ items: [] }),
}));
