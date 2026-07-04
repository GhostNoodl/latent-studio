import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { Check, AlertTriangle, WrapText } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Raw ComfyUI API-format workflow editor — the ultimate power-user escape
 * hatch. Edits here are submitted verbatim to /prompt, bypassing the manifest.
 */
export function RawEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const error = useMemo(() => {
    try {
      JSON.parse(value);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Invalid JSON";
    }
  }, [value]);

  function format() {
    try {
      onChange(JSON.stringify(JSON.parse(value), null, 2));
    } catch {
      /* leave as-is when unparseable */
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs">
          {error ? (
            <span className="flex items-center gap-1.5 text-[var(--color-danger)]">
              <AlertTriangle className="h-3.5 w-3.5" /> Invalid JSON
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[var(--color-good)]">
              <Check className="h-3.5 w-3.5" /> Valid workflow
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={format} disabled={!!error}>
          <WrapText className="h-3.5 w-3.5" /> Format
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <CodeMirror
          value={value}
          onChange={onChange}
          theme="dark"
          extensions={[json()]}
          basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
          style={{ fontSize: 13 }}
        />
      </div>
      {error && (
        <div className="border-t border-[var(--color-line)] px-4 py-2 font-mono text-[11px] text-[var(--color-danger)]">
          {error}
        </div>
      )}
    </div>
  );
}
