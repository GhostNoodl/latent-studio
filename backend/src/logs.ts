import { bridge } from "./ws-bridge.ts";
import type { LogEntry, LogSource } from "@latent/shared";

/**
 * In-memory ring buffer of process output (this backend + the ComfyUI it owns),
 * fanned out live over the WS bridge and snapshotted via GET /api/logs. Lets the
 * two console windows stay hidden while their output is viewable inside Latent.
 */

const CAP = 2000; // lines kept per source
const buffers: Record<LogSource, LogEntry[]> = { backend: [], comfy: [] };
let seq = 0;

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

function levelOf(text: string): LogEntry["level"] {
  if (/\b(error|err|exception|traceback|failed|fatal)\b/i.test(text)) return "error";
  if (/\b(warn|warning|deprecated)\b/i.test(text)) return "warn";
  return "info";
}

export const logs = {
  push(source: LogSource, chunk: string): void {
    for (const raw of chunk.split(/\r?\n/)) {
      const text = raw.replace(ANSI, "").replace(/\s+$/, "");
      if (!text) continue;
      const entry: LogEntry = { id: ++seq, source, text, at: Date.now(), level: levelOf(text) };
      const buf = buffers[source];
      buf.push(entry);
      if (buf.length > CAP) buf.splice(0, buf.length - CAP);
      bridge.broadcast({ type: "log", entry });
    }
  },

  snapshot(source?: LogSource): LogEntry[] {
    if (source) return [...buffers[source]];
    return [...buffers.backend, ...buffers.comfy].sort((a, b) => a.id - b.id);
  },
};

/**
 * Tee this process's own stdout/stderr into the backend log buffer so the
 * Fastify/pino output shows up in the in-app console. Call once at startup.
 */
export function captureConsole(): void {
  for (const stream of ["stdout", "stderr"] as const) {
    const target = process[stream] as NodeJS.WriteStream & {
      write: (...a: unknown[]) => boolean;
    };
    const original = target.write.bind(target);
    target.write = (chunk: unknown, encoding?: unknown, cb?: unknown) => {
      try {
        const s = typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString();
        logs.push("backend", s);
      } catch {
        /* never let logging break real output */
      }
      return (original as (...a: unknown[]) => boolean)(chunk, encoding, cb);
    };
  }
}
