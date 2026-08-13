import type { PipelineType } from "@latent/shared";

const VIDEO_EXTS = /\.(mp4|webm|mov|m4v)$/i;
const AUDIO_EXTS = /\.(mp3|wav|flac|ogg|oga|opus|m4a|aac)$/i;

/** Classify a ComfyUI output by filename. Unknown output formats retain the
 * historical image fallback so existing custom image nodes keep working. */
export function outputTypeForFilename(filename: string): PipelineType {
  if (VIDEO_EXTS.test(filename)) return "video";
  if (AUDIO_EXTS.test(filename)) return "audio";
  return "image";
}
