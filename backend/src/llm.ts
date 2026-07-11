import { settings } from "./db.ts";
import type { ChatMessage, LlmConfig, LlmConfigInput } from "@latent/shared";

/**
 * LLM provider layer for the Prompt Studio assistant. Speaks the OpenAI
 * `POST {baseUrl}/chat/completions` protocol, which every relevant backend
 * supports — OpenAI, OpenRouter, Ollama (`/v1`), LM Studio, and Anthropic's
 * OpenAI-compat endpoint — so there's one code path and no per-vendor SDK.
 *
 * Config is a JSON blob in the settings table (mirrors model-paths.ts). The API
 * key never leaves the backend except on the wire to the provider — the public
 * config only reports whether a key is set (`hasKey`).
 */

const KEY = "llmConfig";

interface StoredConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

const EMPTY: StoredConfig = { baseUrl: "", apiKey: "", model: "", enabled: false };

/** Raw config incl. the secret key — backend-only. */
export function getStoredLlmConfig(): StoredConfig {
  try {
    const parsed = JSON.parse(settings.get(KEY) ?? "{}") as Partial<StoredConfig>;
    return {
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      model: typeof parsed.model === "string" ? parsed.model : "",
      enabled: parsed.enabled === true,
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Public config for the UI — the key is redacted to a boolean. */
export function getLlmConfig(): LlmConfig {
  const c = getStoredLlmConfig();
  return { baseUrl: c.baseUrl, model: c.model, enabled: c.enabled, hasKey: Boolean(c.apiKey) };
}

/** Whether the assistant is usable (enabled + has an endpoint + a model). */
export function isLlmReady(): boolean {
  const c = getStoredLlmConfig();
  return c.enabled && Boolean(c.baseUrl) && Boolean(c.model);
}

/**
 * Persist config. An empty `apiKey` string is treated as "keep the existing key"
 * so the UI (which never receives the key) can save other fields without wiping
 * it; pass a whitespace-only string to intentionally clear it.
 */
export function setLlmConfig(input: LlmConfigInput): void {
  const prev = getStoredLlmConfig();
  const next: StoredConfig = {
    baseUrl: (input.baseUrl ?? "").trim().replace(/\/+$/, ""),
    model: (input.model ?? "").trim(),
    enabled: input.enabled === true,
    // "" (untouched password field) → keep; anything else (incl. "  ") → set/clear.
    apiKey: input.apiKey === "" ? prev.apiKey : input.apiKey.trim(),
  };
  settings.set(KEY, JSON.stringify(next));
}

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

function authHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

/** Actionable hint for a status code, or null to just show the raw provider message. */
function statusHint(status: number): string | null {
  switch (status) {
    case 401:
      return "Provider rejected the API key (401) — make sure it's current and issued by this provider";
    case 403:
      return "Access forbidden (403) — the key may not have access to this model";
    case 402:
      return "Payment required (402) — the account may be out of credits";
    case 404:
      return "Not found (404) — check the base URL and the model slug";
    case 429:
      return "Rate limited (429) — too many requests, or the account is out of quota/credits";
    default:
      if (status >= 500) return `Provider server error (${status}) — try again in a moment`;
      return null;
  }
}

/**
 * Human-readable error from a failed provider response. Prefixes a status-based
 * hint (e.g. a 401 → "check the key") in front of the provider's own message, so
 * a cryptic reply like "User not found." becomes actionable.
 */
async function providerError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  let raw = "";
  try {
    const j = JSON.parse(text);
    const msg = j?.error?.message ?? j?.error ?? j?.message;
    if (msg) raw = typeof msg === "string" ? msg : JSON.stringify(msg);
  } catch {
    raw = text.slice(0, 300);
  }
  const hint = statusHint(res.status);
  if (hint) return raw ? `${hint} (provider said: “${raw}”)` : hint;
  return raw || `${res.status} ${res.statusText}`;
}

/**
 * Non-streaming completion — used by the "Test connection" button and any
 * one-shot call. Throws with a clean message on any failure.
 */
export async function chat(messages: ChatMessage[], opts: { signal?: AbortSignal } = {}): Promise<string> {
  const c = getStoredLlmConfig();
  if (!c.baseUrl) throw new Error("No LLM endpoint configured");
  if (!c.model) throw new Error("No LLM model configured");

  const res = await fetch(endpoint(c.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(c.apiKey) },
    body: JSON.stringify({ model: c.model, messages, stream: false }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(await providerError(res));

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Streaming completion — yields token deltas as they arrive. Parses OpenAI-style
 * SSE (`data: {json}\n\n`, terminated by `data: [DONE]`). Honors an AbortSignal
 * so the UI can stop a long generation mid-stream.
 */
export async function* chatStream(
  messages: ChatMessage[],
  opts: { signal?: AbortSignal } = {},
): AsyncGenerator<string> {
  const c = getStoredLlmConfig();
  if (!c.baseUrl) throw new Error("No LLM endpoint configured");
  if (!c.model) throw new Error("No LLM model configured");

  const res = await fetch(endpoint(c.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(c.apiKey) },
    body: JSON.stringify({ model: c.model, messages, stream: true }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(await providerError(res));
  if (!res.body) throw new Error("No response body from provider");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line; process each complete one.
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of event.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload) as {
              choices?: { delta?: { content?: string } }[];
            };
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            /* skip a partial/non-JSON keepalive line */
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
