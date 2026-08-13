import { test } from "node:test";
import assert from "node:assert/strict";
import {
  musicCaptionKey,
  musicLyricsKey,
  negPromptKey,
  posPromptKey,
} from "../frontend/src/lib/promptKeys.ts";
import type { WorkflowManifest, ParamSpec } from "@latent/shared";

function manifestWith(params: Partial<ParamSpec>[]): WorkflowManifest {
  return { params: params as ParamSpec[] } as unknown as WorkflowManifest;
}

test("posPromptKey prefers a positive-labeled textarea", () => {
  const m = manifestWith([
    { key: "1.text", control: "textarea", label: "Positive prompt" },
    { key: "2.text", control: "textarea", label: "Negative prompt" },
  ]);
  assert.equal(posPromptKey(m), "1.text");
  assert.equal(negPromptKey(m), "2.text");
});

test("posPromptKey falls back to a bare 'Prompt' textarea (MiniMax H3)", () => {
  const m = manifestWith([
    { key: "5.prompt", control: "textarea", label: "Prompt" },
    { key: "9.expression", control: "textarea", label: "Expression" },
  ]);
  assert.equal(posPromptKey(m), "5.prompt");
  assert.equal(negPromptKey(m), undefined);
});

test("positive label wins over an earlier bare 'Prompt'", () => {
  const m = manifestWith([
    { key: "5.prompt", control: "textarea", label: "Prompt" },
    { key: "7.text", control: "textarea", label: "Positive prompt" },
  ]);
  assert.equal(posPromptKey(m), "7.text");
});

test("no textarea prompt-like param → undefined", () => {
  const m = manifestWith([
    { key: "6.value", control: "number", label: "Width" },
    { key: "9.expression", control: "textarea", label: "Expression" },
  ]);
  assert.equal(posPromptKey(m), undefined);
});

test("Music 3 caption and lyrics are located independently by input name", () => {
  const m = manifestWith([
    { key: "5.caption", input: "caption", control: "textarea", label: "Song direction" },
    { key: "5.lyrics", input: "lyrics", control: "textarea", label: "Words" },
  ]);
  assert.equal(musicCaptionKey(m), "5.caption");
  assert.equal(musicLyricsKey(m), "5.lyrics");
  assert.equal(posPromptKey(m), undefined);
});
