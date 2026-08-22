import { create } from "zustand";

/** A single stop on the interactive tour, anchored to a `data-tour="target"` element. */
export interface TourStep {
  target: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  { target: "nav-create", title: "Create", body: "Make images, video, and music with simple controls up front and deeper options when you need them." },
  { target: "nav-library", title: "Library", body: "Everything you make is saved here, searchable and easy to group into albums." },
  { target: "nav-models", title: "Models", body: "Manage installed models or browse for new ones from one place." },
  { target: "nav-console", title: "Console", body: "Live ComfyUI + backend logs — and the Quit button — live here." },
];

interface TourStore {
  active: boolean;
  index: number;
  start: () => void;
  next: () => void;
  prev: () => void;
  stop: () => void;
}

export const useTour = create<TourStore>((set, get) => ({
  active: false,
  index: 0,
  start: () => set({ active: true, index: 0 }),
  next: () => {
    const i = get().index + 1;
    if (i >= TOUR_STEPS.length) set({ active: false, index: 0 });
    else set({ index: i });
  },
  prev: () => set({ index: Math.max(0, get().index - 1) }),
  stop: () => set({ active: false, index: 0 }),
}));
