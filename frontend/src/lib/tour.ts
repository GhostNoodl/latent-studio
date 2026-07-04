import { create } from "zustand";

/** A single stop on the interactive tour, anchored to a `data-tour="target"` element. */
export interface TourStep {
  target: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  { target: "nav-generate", title: "Generate", body: "Craft images & video here — every pipeline setting exposed as a clean control." },
  { target: "nav-gallery", title: "Gallery", body: "Everything you make is saved here, searchable and taggable." },
  { target: "nav-models", title: "Models", body: "Your installed checkpoints, LoRAs, VAEs & more — organize them into folders." },
  { target: "nav-discover", title: "Discover", body: "Browse and download models from Civitai without leaving the app." },
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
