import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_THEME_ID } from "@/lib/theme";

/** Local UI preferences, persisted to localStorage across restarts. */
interface Prefs {
  /** Most recently opened generation pipeline, used as the Create landing. */
  lastPipelineId?: string;
  setLastPipelineId: (id: string) => void;

  /** Show the Batch builder button in the generate bar. */
  showBatchBuilder: boolean;
  setShowBatchBuilder: (v: boolean) => void;

  /** Accent theme: a preset id or "custom". */
  themeId: string;
  /** Primary accent used when themeId === "custom". */
  customPrimary: string;
  setTheme: (id: string) => void;
  setCustomPrimary: (hex: string) => void;

  /** Left navigation sidebar collapsed (desktop). */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  /** Keep the positive / negative prompt across restarts (per device). When off,
   * prompts start fresh each session. */
  lockPositivePrompt: boolean;
  lockNegativePrompt: boolean;
  setLockPositivePrompt: (v: boolean) => void;
  setLockNegativePrompt: (v: boolean) => void;
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      lastPipelineId: undefined,
      setLastPipelineId: (lastPipelineId) => set({ lastPipelineId }),

      showBatchBuilder: false,
      setShowBatchBuilder: (showBatchBuilder) => set({ showBatchBuilder }),

      themeId: DEFAULT_THEME_ID,
      customPrimary: "#e8c15a",
      setTheme: (themeId) => set({ themeId }),
      setCustomPrimary: (customPrimary) => set({ customPrimary, themeId: "custom" }),

      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      lockPositivePrompt: false,
      lockNegativePrompt: false,
      setLockPositivePrompt: (lockPositivePrompt) => set({ lockPositivePrompt }),
      setLockNegativePrompt: (lockNegativePrompt) => set({ lockNegativePrompt }),
    }),
    { name: "latent-prefs" },
  ),
);
