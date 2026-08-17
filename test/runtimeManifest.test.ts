import assert from "node:assert/strict";
import test from "node:test";
import { MANAGED_RUNTIME, managedRuntimeHasDrift } from "../backend/src/runtime-manifest.ts";

test("managed runtime drift detects missing and mismatched components", () => {
  const desired = {
    comfy: MANAGED_RUNTIME.comfy.commit,
    manager: MANAGED_RUNTIME.manager.commit,
  };

  assert.equal(managedRuntimeHasDrift({ ...desired }, desired), false);
  assert.equal(managedRuntimeHasDrift({ comfy: desired.comfy }, desired), true);
  assert.equal(managedRuntimeHasDrift({ ...desired, comfy: "different" }, desired), true);
});

test("Windows runtime archives are immutable and integrity-pinned", () => {
  assert.match(MANAGED_RUNTIME.comfy.tag, /^v\d+\.\d+\.\d+$/);
  assert.match(MANAGED_RUNTIME.comfy.commit, /^[a-f0-9]{40}$/);
  for (const runtime of Object.values(MANAGED_RUNTIME.comfy.windows)) {
    assert.ok(runtime.sizeBytes > 1_000_000_000);
    assert.match(runtime.sha256, /^[a-f0-9]{64}$/);
  }
});
