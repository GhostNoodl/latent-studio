import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const STAMP_NAME = ".latent-package-lock.sha256";

function packageLockHash(root) {
  const lockPath = resolve(root, "package-lock.json");
  if (!existsSync(lockPath)) return null;
  return createHash("sha256").update(readFileSync(lockPath)).digest("hex");
}

export function dependencyState(root, verifyInstalled = null) {
  const modulesLock = resolve(root, "node_modules", ".package-lock.json");
  if (!existsSync(modulesLock)) {
    return { needsInstall: true, reason: "missing" };
  }

  const expectedHash = packageLockHash(root);
  const stampPath = resolve(root, "node_modules", STAMP_NAME);
  let installedHash = null;
  try {
    installedHash = readFileSync(stampPath, "utf8").trim();
  } catch {
    // Existing installs from before dependency stamps were introduced get one
    // automatic reconciliation, then future launches can use the fast hash check.
  }
  if (expectedHash && installedHash !== expectedHash) {
    return { needsInstall: true, reason: "lockfile-changed" };
  }

  if (verifyInstalled && !verifyInstalled()) {
    return { needsInstall: true, reason: "invalid-tree" };
  }

  return { needsInstall: false, reason: "current" };
}

export function recordDependencyState(root) {
  const hash = packageLockHash(root);
  if (!hash) return false;
  try {
    writeFileSync(resolve(root, "node_modules", STAMP_NAME), `${hash}\n`, "utf8");
    return true;
  } catch {
    // The install itself may still be usable in a read-only or aggressively
    // protected folder. Recheck it next launch instead of blocking startup.
    return false;
  }
}
