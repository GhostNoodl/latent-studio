import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { dependencyState, recordDependencyState } from "../scripts/dependency-state.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "latent-deps-test-"));
  await writeFile(path.join(root, "package-lock.json"), '{"lockfileVersion":3}\n');
  return root;
}

test("dependency state requests an install when node_modules is absent", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  assert.deepEqual(dependencyState(root), { needsInstall: true, reason: "missing" });
});

test("dependency state detects lockfile changes and incomplete installs", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "node_modules"));
  await writeFile(path.join(root, "node_modules", ".package-lock.json"), "{}\n");

  assert.equal(dependencyState(root).reason, "lockfile-changed");
  assert.equal(recordDependencyState(root), true);
  assert.deepEqual(dependencyState(root, () => true), { needsInstall: false, reason: "current" });
  assert.deepEqual(dependencyState(root, () => false), {
    needsInstall: true,
    reason: "invalid-tree",
  });

  await writeFile(path.join(root, "package-lock.json"), '{"lockfileVersion":3,"changed":true}\n');
  assert.equal(dependencyState(root).reason, "lockfile-changed");
  assert.match(
    await readFile(path.join(root, "node_modules", ".latent-package-lock.sha256"), "utf8"),
    /^[a-f0-9]{64}\n$/,
  );
});
