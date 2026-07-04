import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Point the wildcards engine at a throwaway fixture dir BEFORE importing it
// (config.ts reads WILDCARDS_DIR at module load).
const dir = join(tmpdir(), `latent-wc-test-${Date.now()}`);
process.env.WILDCARDS_DIR = dir;
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "color.txt"), "crimson\n"); // single line → deterministic
writeFileSync(join(dir, "animal.txt"), "cat\ndog\nfox\n");
writeFileSync(join(dir, "commented.txt"), "# a heading\nonly\n"); // comment ignored
mkdirSync(join(dir, "sub"), { recursive: true });
writeFileSync(join(dir, "sub", "nested.txt"), "deep\n");

const { expandWildcards, listWildcards } = await import("../backend/src/wildcards.ts");

after(() => rmSync(dir, { recursive: true, force: true }));

test("__name__ expands to the file's line", () => {
  assert.equal(expandWildcards("__color__"), "crimson");
});

test("__name__ picks from a multi-line file", () => {
  const out = expandWildcards("a __animal__ b");
  assert.match(out, /^a (cat|dog|fox) b$/);
});

test("comment lines (#) are ignored", () => {
  assert.equal(expandWildcards("__commented__"), "only");
});

test("unknown wildcard is left literal", () => {
  assert.equal(expandWildcards("__nope__"), "__nope__");
});

test("{a|b|c} inline choice picks one option", () => {
  assert.ok(["x", "y", "z"].includes(expandWildcards("{x|y|z}")));
});

test("nested sub-folder wildcards resolve via slash", () => {
  assert.equal(expandWildcards("__sub/nested__"), "deep");
});

test("combined file + inline expansion", () => {
  assert.equal(expandWildcards("__color__ {p}"), "crimson p");
});

test("non-string / plain text passes through unchanged", () => {
  assert.equal(expandWildcards("just text"), "just text");
  assert.equal(expandWildcards(123 as unknown as string), 123 as unknown as string);
});

test("listWildcards enumerates files recursively", () => {
  const names = listWildcards();
  for (const n of ["color", "animal", "commented", "sub/nested"]) assert.ok(names.includes(n), n);
});
