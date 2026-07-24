import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Sparkles,
  X,
  Send,
  Square,
  Check,
  Copy,
  Loader2,
  ArrowDownToLine,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@latent/shared";

interface Props {
  pipelineName: string;
  /** "video" switches Prompt Studio to LTX prose prompting (long scene descriptions). */
  pipelineType?: "image" | "video";
  /** Live positive/negative prompt text (for grounding + seeding). */
  positive: string;
  negative: string;
  hasNegative: boolean;
  /** Replace / append the positive or negative prompt in the generate form. */
  onApply: (target: "positive" | "negative", text: string, mode: "replace" | "append") => void;
  onClose: () => void;
}

/**
 * Pull the most prompt-like passage out of an assistant message. Image pipelines:
 * the line with the most commas (a tag list). Video pipelines: the longest prose
 * paragraph (LTX prompts are verbose scenes). Either way, minus any
 * "Positive prompt:" style label; falls back to the whole trimmed message.
 */
function extractPrompt(text: string, video: boolean): string {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return text.trim();
  let best = lines[0]!;
  let bestScore = -1;
  for (const l of lines) {
    const score = video ? l.length : (l.match(/,/g) ?? []).length;
    if (score > bestScore) {
      bestScore = score;
      best = l;
    }
  }
  return best.replace(/^(positive|negative)\s*(prompt)?\s*[:\-—]\s*/i, "").trim();
}

const IMAGE_QUICK_ACTIONS: { label: string; send: string }[] = [
  { label: "Enhance my prompt", send: "Improve my current prompt — richer detail and better tags, same subject and vibe. Return the full improved prompt." },
  { label: "Complete from fragments", send: "Take what I have and flesh it out into a complete, coherent prompt. Return the full prompt." },
  { label: "More detail", send: "Add more fine detail tags (lighting, materials, background, rendering) without changing the subject. Return the full prompt." },
  { label: "Suggest a background", send: "Suggest a fitting background/setting for this and return the full prompt with it added." },
  { label: "More NSFW", send: "Make this more explicit/NSFW. Add appropriate explicit tags. Return the full prompt." },
];

const VIDEO_QUICK_ACTIONS: { label: string; send: string }[] = [
  { label: "Enhance my prompt", send: "Improve my current prompt — richer visual detail and clearer chronological action, same subject and vibe. Return the full improved prompt." },
  { label: "Complete from fragments", send: "Take what I have and flesh it out into a complete video prompt — scene, action beats, camera, lighting. Return the full prompt." },
  { label: "Add motion", send: "Give this scene more and clearer motion — describe actions chronologically as they unfold over a few seconds. Return the full prompt." },
  { label: "Camera + lighting", send: "Add a fitting camera shot/movement and lighting description to this prompt. Return the full prompt." },
  { label: "Add sound design", send: "Add fitting synchronized audio to this prompt — ambience, foley, any dialogue in quotes. Return the full prompt." },
  { label: "More NSFW", send: "Make this scene more explicit/NSFW, written as verbose sensory prose. Return the full prompt." },
];

export function PromptStudio({
  pipelineName,
  pipelineType = "image",
  positive,
  negative,
  hasNegative,
  onApply,
  onClose,
}: Props) {
  const isVideo = pipelineType === "video";
  const { data: cfg, isLoading: cfgLoading } = useQuery({
    queryKey: ["llmConfig"],
    queryFn: api.llmConfig,
  });
  const ready = Boolean(cfg?.enabled && cfg?.baseUrl && cfg?.model);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streaming]);

  // Cancel any in-flight stream if the drawer unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function send(text: string) {
    const content = text.trim();
    if (!content || streaming) return;
    setError(null);
    setInput("");

    const history: ChatMessage[] = [...messages, { role: "user", content }];
    // Placeholder assistant message we stream into.
    setMessages([...history, { role: "assistant", content: "" }]);
    setStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await api.promptChatStream(
        {
          messages: history,
          seed: { positive, negative, pipelineName, pipelineType },
        },
        (delta) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") next[next.length - 1] = { ...last, content: last.content + delta };
            return next;
          });
        },
        ac.signal,
      );
    } catch (err) {
      if (!ac.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-black/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.aside
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-[var(--color-line-strong)] bg-[var(--color-surface)] shadow-2xl"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.22, ease: "easeOut" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-[var(--color-amber)]" /> Prompt Studio
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--color-faint)] transition-colors hover:bg-[var(--color-elevated)] hover:text-[var(--color-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!ready ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
            <SlidersHorizontal className="h-8 w-8 text-[var(--color-faint)]" />
            <p className="text-sm text-[var(--color-muted)]">
              {cfgLoading ? "Loading…" : "The prompt assistant isn't set up yet."}
            </p>
            {!cfgLoading && (
              <Link
                to="/settings"
                onClick={onClose}
                className="text-sm text-[var(--color-amber)] hover:underline"
              >
                Configure it in Settings →
              </Link>
            )}
          </div>
        ) : (
          <>
            {/* Transcript */}
            <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.length === 0 && (
                <div className="mt-2 text-center text-xs text-[var(--color-faint)]">
                  Chat to build your prompt. Tags come out booru/e621-style, grounded in your tag
                  library. Try a quick action below.
                </div>
              )}
              {messages.map((m, i) => (
                <Bubble
                  key={i}
                  message={m}
                  streaming={streaming && i === messages.length - 1 && m.role === "assistant"}
                  hasNegative={hasNegative}
                  isVideo={isVideo}
                  onApply={onApply}
                />
              ))}
              {error && (
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
                  {error}
                </div>
              )}
            </div>

            {/* Quick actions */}
            <div className="flex flex-wrap gap-1 border-t border-[var(--color-line)] px-3 py-2">
              {(isVideo ? VIDEO_QUICK_ACTIONS : IMAGE_QUICK_ACTIONS).map((qa) => (
                <button
                  key={qa.label}
                  type="button"
                  disabled={streaming}
                  onClick={() => send(qa.send)}
                  className="rounded-full border border-[var(--color-line)] px-2 py-0.5 text-[10px] text-[var(--color-muted)] transition-colors hover:border-[var(--color-amber)] hover:text-[var(--color-amber)] disabled:opacity-40"
                >
                  {qa.label}
                </button>
              ))}
            </div>

            {/* Composer */}
            <div className="flex items-end gap-2 border-t border-[var(--color-line)] p-3">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                rows={2}
                placeholder="Describe what you want, or ask for changes…"
                className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-amber)]"
              />
              {streaming ? (
                <button
                  type="button"
                  onClick={stop}
                  title="Stop"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] text-[var(--color-muted)] transition-colors hover:text-[var(--color-danger)]"
                >
                  <Square className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => send(input)}
                  disabled={!input.trim()}
                  title="Send (Enter)"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-amber)] text-[var(--color-on-amber)] transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </div>
          </>
        )}
      </motion.aside>
    </>
  );
}

function Bubble({
  message,
  streaming,
  hasNegative,
  isVideo,
  onApply,
}: {
  message: ChatMessage;
  streaming: boolean;
  hasNegative: boolean;
  isVideo: boolean;
  onApply: Props["onApply"];
}) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";
  const tagLine = extractPrompt(message.content, isVideo);

  async function copy() {
    await navigator.clipboard.writeText(tagLine).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[88%] rounded-[var(--radius-sm)] px-3 py-2 text-sm",
          isUser
            ? "bg-[var(--color-elevated)] text-[var(--color-text)]"
            : "border border-[var(--color-line)] bg-[var(--color-ink)] text-[var(--color-text)]",
        )}
      >
        <div className="whitespace-pre-wrap break-words">
          {message.content}
          {streaming && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-[var(--color-amber)] align-middle" />}
        </div>

        {/* Apply actions on completed assistant messages that produced a prompt. */}
        {!isUser && !streaming && message.content.trim() && (
          <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-[var(--color-line)] pt-2">
            <ApplyBtn icon={<Check className="h-3 w-3" />} label="To prompt" onClick={() => onApply("positive", tagLine, "replace")} />
            <ApplyBtn icon={<Plus className="h-3 w-3" />} label="Append" onClick={() => onApply("positive", tagLine, "append")} />
            {hasNegative && (
              <ApplyBtn icon={<ArrowDownToLine className="h-3 w-3" />} label="To negative" onClick={() => onApply("negative", tagLine, "replace")} />
            )}
            <ApplyBtn icon={copied ? <Check className="h-3 w-3 text-[var(--color-good)]" /> : <Copy className="h-3 w-3" />} label={copied ? "Copied" : "Copy"} onClick={copy} />
          </div>
        )}
      </div>
    </div>
  );
}

function ApplyBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-elevated)] hover:text-[var(--color-amber)]"
    >
      {icon}
      {label}
    </button>
  );
}
