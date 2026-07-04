import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_THEME_ID } from "@/lib/theme";

/** Local UI preferences, persisted to localStorage across restarts. */
interface Prefs {
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
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      showBatchBuilder: false,
      setShowBatchBuilder: (showBatchBuilder) => set({ showBatchBuilder }),

      themeId: DEFAULT_THEME_ID,
      customPrimary: "#e8c15a",
      setTheme: (themeId) => set({ themeId }),
      setCustomPrimary: (customPrimary) => set({ customPrimary, themeId: "custom" }),

      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: "latent-prefs" },
  ),
);
