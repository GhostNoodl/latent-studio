import { create } from "zustand";
import type { DownloadJob, GenerationRecord, ServerEvent, SetupStatus } from "@latent/shared";
import { useLogs } from "./logs";

export interface LiveState {
  value: number;
  max: number;
  node: string | null;
  preview?: string;
}

interface WsStore {
  connected: boolean;
  queueRemaining: number;
  /** generationId -> live progress/preview while running. */
  live: Record<string, LiveState>;
  /** downloadId -> live download job. */
  downloads: Record<string, DownloadJob>;
  /** Live first-run ComfyUI setup status (undefined until an event arrives). */
  setup?: SetupStatus;
  connect: () => void;
  /** Subscribe to finalized generation records (for cache invalidation). */
  onRecord: (cb: (rec: GenerationRecord) => void) => () => void;
  /** Subscribe to download job updates (for cache invalidation). */
  onDownload: (cb: (job: DownloadJob) => void) => () => void;
  /** Drop a finished download from the tray. */
  dismissDownload: (id: string) => void;
}

const recordListeners = new Set<(rec: GenerationRecord) => void>();
const downloadListeners = new Set<(job: DownloadJob) => void>();
let socket: WebSocket | null = null;

export const useWs = create<WsStore>((set, get) => ({
  connected: false,
  queueRemaining: 0,
  live: {},
  downloads: {},

  connect: () => {
    if (socket && socket.readyState <= WebSocket.OPEN) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    socket = ws;

    ws.onopen = () => set({ connected: true });
    ws.onclose = () => {
      set({ connected: false });
      socket = null;
      setTimeout(() => get().connect(), 2000);
    };
    ws.onerror = () => ws.close();

    ws.onmessage = (e) => {
      let ev: ServerEvent;
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      handleEvent(ev, set, get);
    };
  },

  onRecord: (cb) => {
    recordListeners.add(cb);
    return () => recordListeners.delete(cb);
  },

  onDownload: (cb) => {
    downloadListeners.add(cb);
    return () => downloadListeners.delete(cb);
  },

  dismissDownload: (id) =>
    set((s) => {
      const next = { ...s.downloads };
      delete next[id];
      return { downloads: next };
    }),
}));

function handleEvent(
  ev: ServerEvent,
  set: (partial: Partial<WsStore> | ((s: WsStore) => Partial<WsStore>)) => void,
  get: () => WsStore,
): void {
  switch (ev.type) {
    case "status":
      set({ queueRemaining: ev.queueRemaining });
      break;
    case "progress":
      if (!ev.generationId) break;
      set((s) => ({
        live: {
          ...s.live,
          [ev.generationId!]: {
            ...(s.live[ev.generationId!] ?? { node: null }),
            value: ev.value,
            max: ev.max,
          },
        },
      }));
      break;
    case "executing":
      if (!ev.generationId) break;
      set((s) => ({
        live: {
          ...s.live,
          [ev.generationId!]: {
            ...(s.live[ev.generationId!] ?? { value: 0, max: 0 }),
            node: ev.node,
          },
        },
      }));
      break;
    case "preview":
      if (!ev.generationId) break;
      set((s) => ({
        live: {
          ...s.live,
          [ev.generationId!]: {
            ...(s.live[ev.generationId!] ?? { value: 0, max: 0, node: null }),
            preview: ev.dataUrl,
          },
        },
      }));
      break;
    case "generation": {
      // Clear live state on ANY terminal status (completed/failed/canceled) —
      // otherwise a canceled/interrupted run stays "live" and haunts the queue.
      if (ev.record.status !== "running" && ev.record.status !== "queued") {
        const next = { ...get().live };
        delete next[ev.record.id];
        set({ live: next });
      }
      for (const cb of recordListeners) cb(ev.record);
      break;
    }
    case "download":
      set((s) => ({ downloads: { ...s.downloads, [ev.job.id]: ev.job } }));
      for (const cb of downloadListeners) cb(ev.job);
      break;
    case "setup":
      set({ setup: ev.status });
      break;
    case "log":
      useLogs.getState().add(ev.entry);
      break;
    case "error":
      break;
  }
}
