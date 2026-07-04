import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Notification {
  id: string;
  status: "success" | "error" | "info";
  title: string;
  body?: string;
  /** epoch ms */
  at: number;
  read: boolean;
  /** de-dupe key (e.g. a download/generation id) so repeated events add once. */
  sourceId?: string;
}

interface NotifStore {
  items: Notification[];
  add: (n: { status: Notification["status"]; title: string; body?: string; sourceId?: string }) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clear: () => void;
}

/** Persistent notification history (finished downloads, failures, …). */
export const useNotifications = create<NotifStore>()(
  persist(
    (set, get) => ({
      items: [],
      add: (n) => {
        if (n.sourceId && get().items.some((i) => i.sourceId === n.sourceId)) return;
        const item: Notification = {
          id: crypto.randomUUID(),
          at: Date.now(),
          read: false,
          ...n,
        };
        set((s) => ({ items: [item, ...s.items].slice(0, 60) }));
      },
      markAllRead: () => set((s) => ({ items: s.items.map((i) => ({ ...i, read: true })) })),
      remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
      clear: () => set({ items: [] }),
    }),
    { name: "latent-notifications" },
  ),
);
