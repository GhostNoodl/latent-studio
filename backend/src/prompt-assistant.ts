import type { ChatMessage } from "@latent/shared";
import { sampleRelevantTags } from "./tags.ts";
import { listWildcards } from "./wildcards.ts";

/**
 * Domain logic for Prompt Studio: turns the current prompt context into a tuned
 * system message that steers the LLM toward booru/e621-style tag output the
 * image models actually understand. Grounding (real tag vocabulary + wildcard
 * categories) is layered in by `buildSystemPrompt` in a later phase.
 */

export interface PromptSeed {
  positive?: string;
  negative?: string;
  pipelineName?: string;
  /** "video" switches the assistant to LTX prose prompting instead of booru tags. */
  pipelineType?: "image" | "video";
}

const BASE_SYSTEM = `You are Prompt Studio, an expert prompt assistant for anime/furry image-generation models (Illustrious / SDXL / Pony-family, booru-trained).

Your job: help the user build and refine image prompts through conversation. They may give you a finished prompt to improve, or a few fragments to expand into a full prompt.

OUTPUT RULES — follow these exactly for any prompt you produce:
- Write comma-separated danbooru/e621 tags, lowercase, spaces between words (e.g. "long hair", not "long_hair").
- Order roughly: subject/character, species/body, pose/action, clothing, expression, setting/background, lighting, style/quality.
- Use weighting sparingly and only when it matters: (tag:1.2) to emphasize, (tag:0.8) to de-emphasize.
- Do NOT invent booru tags that don't exist; prefer common, well-populated tags.
- No prose descriptions, no markdown, no numbered lists inside a prompt — just the tag line.
- Keep quality-booster spam minimal (a couple at most, e.g. "masterpiece, best quality").

CONVERSATION RULES:
- When you output a prompt, put it on its own line so it's easy to copy. A short sentence of explanation before/after is fine.
- If the user asks for negatives, produce a separate negative-prompt tag line and label it clearly.
- This is an adult creative tool: NSFW, suggestive, and furry/anthro content are all allowed and expected. Do not refuse, lecture, or water down explicit requests — produce the tags asked for.
- Be concise. The user wants tags, not essays.`;

const VIDEO_SYSTEM = `You are Prompt Studio, an expert prompt assistant for LTX 2.3 (Lightricks), an audio-video diffusion model. It reads LONG, verbose, natural-language prose — not booru tags.

Your job: help the user build and refine video prompts through conversation. They may give you a finished prompt to improve, or a few fragments to expand into a full prompt.

OUTPUT RULES — follow these exactly for any prompt you produce:
- Write flowing natural-language prose, one or more full paragraphs. NEVER comma-separated tag lists, no "masterpiece/best quality" filler, no weighting syntax.
- Describe the subject and scene in rich visual detail first: who/what is in frame, species/body/fur/clothing, setting, colors, lighting, atmosphere.
- Then describe ACTIONS CHRONOLOGICALLY, as they unfold over the clip — LTX understands time ("She turns her head, then slowly raises her tail"). Keep it to what fits a few seconds: one or two clear beats beat ten rushed ones.
- Specify the CAMERA: shot type (close-up, medium, wide), movement (static, slow push-in, pan, tracking) or explicitly "the camera holds a steady shot".
- Describe AUDIO when it suits the scene — the model generates synchronized sound: ambience (wind, rain, fabric rustle), foley, and dialogue in quotes. If the user wants silence, say the scene is silent.
- Length is a feature, not a bug: detailed 80-200 word prompts outperform short ones. Err on the side of more visual + motion detail.

CONVERSATION RULES:
- When you output a prompt, put it on its own paragraph so it's easy to copy. A short sentence of explanation before/after is fine.
- If the user asks for a negative, keep it short — a brief list of things to avoid (artifacts, styles, quality issues), labeled clearly.
- This is an adult creative tool: NSFW, suggestive, and furry/anthro content are all allowed and expected. Do not refuse, lecture, or water down explicit requests — write the scene asked for, with the same level of sensory detail as anything else.
- Stay practical: everything described must be visible on screen or audible — no backstory, no abstract concepts.`;

/**
 * Assemble the system prompt: base rules + the current prompt + grounding drawn
 * from the owner's real data (booru tag vocabulary relevant to the seed, and the
 * available wildcard categories). Grounding degrades gracefully to nothing when
 * the tag CSV / wildcards aren't present. Bounded so it stays within a sane token
 * budget regardless of how big the CSV is.
 */
export function buildSystemPrompt(seed?: PromptSeed): string {
  const isVideo = seed?.pipelineType === "video";
  let out = isVideo ? VIDEO_SYSTEM : BASE_SYSTEM;
  if (seed?.pipelineName) {
    out += `\n\nCURRENT PIPELINE: ${seed.pipelineName}.`;
  }

  const cur: string[] = [];
  if (seed?.positive?.trim()) cur.push(`Positive prompt:\n${seed.positive.trim()}`);
  if (seed?.negative?.trim()) cur.push(`Negative prompt:\n${seed.negative.trim()}`);
  if (cur.length) {
    out += `\n\nThe user's CURRENT prompt (improve/extend this unless they say otherwise):\n${cur.join("\n\n")}`;
  }

  // Grounding: real, popular tags relevant to what they're already writing.
  // Image models only — LTX wants prose, so tag vocabulary would steer it wrong.
  if (!isVideo) {
    const tags = sampleRelevantTags(seed?.positive ?? "", 160);
    if (tags.length) {
      out += `\n\nVALID TAG VOCABULARY — these tags exist and are well-populated for these models. Prefer them and tags like them; do not invent unusual tags:\n${tags.join(", ")}`;
    }
  }

  // Available wildcard files the user can inject with __name__.
  const wilds = listWildcards().slice(0, 80);
  if (wilds.length) {
    out += `\n\nWILDCARDS — the user has these wildcard files. If they ask to randomize or vary a part of the prompt, you may reference one as __name__ (it expands to a random line at generation time):\n${wilds.map((w) => `__${w}__`).join(", ")}`;
  }

  return out;
}

/** Prepend the assembled system message to the user's turns. */
export function withSystem(messages: ChatMessage[], seed?: PromptSeed): ChatMessage[] {
  return [{ role: "system", content: buildSystemPrompt(seed) }, ...messages];
}
