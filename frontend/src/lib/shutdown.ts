import { create } from "zustand";
import { api } from "./api";
import { confirm } from "./confirm";

/** Shared "quit Latent" flow, used by the Console drawer and Settings. */
interface ShutdownStore {
  quitting: boolean;
  stopped: boolean;
  quit: () => Promise<void>;
}

export const useShutdown = create<ShutdownStore>((set, get) => ({
  quitting: false,
  stopped: false,
  quit: async () => {
    if (get().quitting) return;
    const ok = await confirm({
      title: "Quit Latent?",
      body: "Stops Latent and the ComfyUI it manages. You can close this tab afterwards.",
      danger: true,
      confirmLabel: "Quit Latent",
    });
    if (!ok) return;
    set({ quitting: true });
    // The server exits mid-response; either way, show the stopped screen.
    await api.shutdown().catch(() => {});
    set({ stopped: true });
  },
}));
