import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Check, Loader2, Plug, X } from "lucide-react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Settings: the Prompt Studio LLM endpoint. Any OpenAI-compatible provider —
 * base URL + optional key + model. Stored locally; the key is write-only (the
 * field is never prefilled, and an empty submit keeps the existing key).
 */
const PRESETS: { label: string; baseUrl: string; note: string }[] = [
  { label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", note: "local, no key" },
  { label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", note: "local, no key" },
  { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", note: "uncensored models" },
];

const inputCls =
  "h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-3 font-mono text-sm outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-amber)]";

export function LlmSettings() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["llmConfig"], queryFn: api.llmConfig });

  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState(""); // "" = leave the stored key untouched
  const [enabled, setEnabled] = useState(false);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<{ state: "idle" | "testing" | "ok" | "err"; msg?: string }>({
    state: "idle",
  });

  useEffect(() => {
    if (!data) return;
    setBaseUrl(data.baseUrl);
    setModel(data.model);
    setEnabled(data.enabled);
  }, [data]);

  async function save() {
    await api.saveLlmConfig({ baseUrl, model, apiKey, enabled });
    setApiKey("");
    qc.invalidateQueries({ queryKey: ["llmConfig"] });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  async function runTest() {
    // Persist first so the test hits exactly what's in the fields.
    await api.saveLlmConfig({ baseUrl, model, apiKey, enabled: true });
    setApiKey("");
    setEnabled(true);
    qc.invalidateQueries({ queryKey: ["llmConfig"] });
    setTest({ state: "testing" });
    try {
      const res = await api.testLlm();
      setTest(res.ok ? { state: "ok", msg: res.model } : { state: "err", msg: res.error });
    } catch (err) {
      setTest({ state: "err", msg: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        <Sparkles className="h-4 w-4 text-[var(--color-amber)]" /> Prompt assistant
      </div>
      <p className="mb-4 text-xs text-[var(--color-muted)]">
        Powers <span className="font-medium">Prompt Studio</span> — chat to build and refine prompts.
        Point it at any OpenAI-compatible endpoint. For NSFW / furry work use a local model
        (Ollama, LM&nbsp;Studio) or an uncensored host — mainstream cloud models refuse it.
      </p>

      <div className="space-y-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-amber)]"
          />
          <span className={enabled ? "text-[var(--color-text)]" : "text-[var(--color-muted)]"}>
            Enable the prompt assistant
          </span>
        </label>

        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
            Base URL
          </div>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://127.0.0.1:11434/v1"
            className={inputCls}
          />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setBaseUrl(p.baseUrl)}
                className="rounded-full border border-[var(--color-line)] px-2 py-0.5 text-[10px] text-[var(--color-muted)] transition-colors hover:border-[var(--color-amber)] hover:text-[var(--color-amber)]"
                title={p.baseUrl}
              >
                {p.label} <span className="text-[var(--color-faint)]">· {p.note}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">Model</div>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. llama3.1:8b-instruct · gpt-4o-mini · anthropic/claude-3.5-sonnet"
            className={inputCls}
          />
        </div>

        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
            API key {data?.hasKey && <span className="text-[var(--color-good)]">· stored</span>}
          </div>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={data?.hasKey ? "•••••••• (leave blank to keep)" : "Optional — blank for local"}
            className={inputCls}
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={save}>
            {saved ? <Check className="h-4 w-4 text-[var(--color-good)]" /> : "Save"}
          </Button>
          <Button variant="ghost" size="sm" onClick={runTest} disabled={test.state === "testing" || !baseUrl || !model}>
            {test.state === "testing" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plug className="h-3.5 w-3.5" />
            )}
            Test connection
          </Button>
          {test.state === "ok" && (
            <span className="flex items-center gap-1 text-xs text-[var(--color-good)]">
              <Check className="h-3.5 w-3.5" /> Connected{test.msg ? ` · ${test.msg}` : ""}
            </span>
          )}
        </div>

        {test.state === "err" && (
          <div className="flex items-start gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-2.5 py-1.5 text-xs text-[var(--color-danger)]">
            <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 break-words">{test.msg}</span>
          </div>
        )}
      </div>
    </Card>
  );
}
