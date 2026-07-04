import { useRef, useState } from "react";
import { Upload, Loader2, ImageIcon } from "lucide-react";
import { api } from "@/lib/api";
import type { ParamValue } from "@latent/shared";

/**
 * Uploads an image to ComfyUI (via the backend) and stores the returned
 * filename as the param value — used for img2img / video start & end frames.
 */
export function ImageUpload({
  value,
  onChange,
}: {
  value: ParamValue;
  onChange: (value: ParamValue) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.split(",")[1] ?? "";
      const res = await api.uploadImage(file.name, base64, file.type || "image/png");
      onChange(res.subfolder ? `${res.subfolder}/${res.name}` : res.name);
      setPreview(dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
        className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-ink)] transition-colors hover:border-[var(--color-amber)]"
      >
        {preview ? (
          <img src={preview} alt="" className="h-full w-full object-contain" />
        ) : value ? (
          <div className="flex flex-col items-center gap-1 text-[var(--color-muted)]">
            <ImageIcon className="h-5 w-5" />
            <span className="max-w-[90%] truncate font-mono text-[10px]">{String(value)}</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-[var(--color-faint)]">
            <Upload className="h-5 w-5" />
            <span className="text-xs">Click or drop an image</span>
          </div>
        )}
        {uploading && (
          <div className="absolute inset-0 grid place-items-center bg-[var(--color-ink)]/70">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--color-amber)]" />
          </div>
        )}
      </button>
      {error && <p className="text-[11px] text-[var(--color-danger)]">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
    </div>
  );
}
