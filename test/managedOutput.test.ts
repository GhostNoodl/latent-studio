import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { resolveContainedOutput } from "../backend/src/managed-comfy-state.ts";

test("managed output resolver accepts files inside the output root", async () => {
  const root = mkdtempSync(join(tmpdir(), "latent-output-"));
  mkdirSync(join(root, "video"));
  writeFileSync(join(root, "video", "clip.mp4"), "probe");
  const result = await resolveContainedOutput(root, "video", "clip.mp4");
  assert.equal(basename(result!), "clip.mp4");
  assert.equal(basename(dirname(result!)), "video");
  assert.equal(readFileSync(result!, "utf8"), "probe");
  rmSync(root, { recursive: true, force: true });
});

test("managed output resolver rejects traversal and absolute references", async () => {
  const root = mkdtempSync(join(tmpdir(), "latent-output-"));
  writeFileSync(join(root, "safe.png"), "probe");
  assert.equal(await resolveContainedOutput(root, "..", "outside.png"), undefined);
  assert.equal(await resolveContainedOutput(root, "", join(root, "safe.png")), undefined);
  assert.equal(await resolveContainedOutput(root, "", "../safe.png"), undefined);
  rmSync(root, { recursive: true, force: true });
});
