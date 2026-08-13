import { test } from "node:test";
import assert from "node:assert/strict";
import { outputTypeForFilename } from "../backend/src/media.ts";

test("output media type follows common audio, video, and image extensions", () => {
  assert.equal(outputTypeForFilename("song.MP3"), "audio");
  assert.equal(outputTypeForFilename("mix.flac"), "audio");
  assert.equal(outputTypeForFilename("clip.webm"), "video");
  assert.equal(outputTypeForFilename("frame.png"), "image");
});
