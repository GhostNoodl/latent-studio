import { config } from "./config.ts";
import { bridge } from "./ws-bridge.ts";
import { comfySupervisor } from "./comfy-supervisor.ts";
import { logs } from "./logs.ts";

/**
 * Clean shutdown of the whole studio, plus auto-shutdown when the last browser
 * tab closes. Presence is tracked via the WS bridge: once at least one client
 * has connected, dropping to zero for a grace window stops Latent + the ComfyUI
 * it owns. The grace window tolerates page reloads (which reconnect quickly).
 */

const IDLE_GRACE_MS = 12_000;
let everConnected = false;
let clientCount = 0;
let idleTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;

export function shutdown(reason: string, code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logs.push("backend", `[latent] Shutting down (${reason})…`);
  comfySupervisor.stop();
  // Give the log line / HTTP response a beat to flush, then exit. Exit code 42 signals
  // the launcher to relaunch (pull the update + rebuild) instead of staying down.
  setTimeout(() => process.exit(code), 250);
}

/** Wire WS presence → auto-shutdown when every client has gone. */
export function installAutoShutdown(): void {
  if (!config.autoShutdown) return; // dev: don't stop the server when a tab closes
  bridge.onPresence = (count: number) => {
    clientCount = count;
    if (count > 0) {
      everConnected = true;
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      return;
    }
    // Zero clients — but only shut down if we'd ever had one (ignore pre-open state).
    if (!everConnected || idleTimer) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (clientCount === 0) shutdown("all tabs closed");
    }, IDLE_GRACE_MS);
  };
}
