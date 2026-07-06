import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Check whether the git checkout is behind origin/main (a newer version is available).
 * Powers the in-app "update available" banner. The actual pull happens at launch (the
 * launcher fast-forwards) — the banner just triggers a restart to apply it.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface UpdateStatus {
  available: boolean;
  behind: number;
  current: string;
  latest: string;
  subject: string;
  checkedAt: string;
}

let cache: UpdateStatus = { available: false, behind: 0, current: "", latest: "", subject: "", checkedAt: "" };
let lastFetch = 0;
const THROTTLE_MS = 5 * 60 * 1000; // don't hit the network more than once per 5 min

function git(cmd: string, timeout = 15000): string {
  return execSync(`git ${cmd}`, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"], timeout })
    .toString()
    .trim();
}

/** Returns the cached status, refreshing (git fetch) at most once per THROTTLE_MS. */
export function updateStatus(force = false): UpdateStatus {
  const now = Date.now();
  if (!force && now - lastFetch < THROTTLE_MS && cache.checkedAt) return cache;
  lastFetch = now;
  try {
    git("rev-parse --is-inside-work-tree"); // not a git checkout → throws → caught
    const branch = git("rev-parse --abbrev-ref HEAD");
    git("fetch --quiet origin main"); // offline → throws → caught (keeps last cache)
    const current = git("rev-parse HEAD");
    const latest = git("rev-parse origin/main");
    const onMain = branch === "main";
    // Only "behind" if we can fast-forward (HEAD is an ancestor of origin/main).
    let behind = 0;
    if (onMain && current !== latest) {
      try {
        execSync("git merge-base --is-ancestor HEAD origin/main", { cwd: ROOT, stdio: "ignore" });
        behind = Number(git("rev-list --count HEAD..origin/main")) || 0;
      } catch {
        behind = 0; // ahead or diverged — not an update we'd auto-apply
      }
    }
    cache = {
      available: behind > 0,
      behind,
      current: current.slice(0, 7),
      latest: latest.slice(0, 7),
      subject: behind ? git("log -1 --format=%s origin/main") : "",
      checkedAt: new Date(now).toISOString(),
    };
  } catch {
    cache = { ...cache, checkedAt: new Date(now).toISOString() };
  }
  return cache;
}
