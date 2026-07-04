import { create } from "zustand";

export interface PromptOptions {
  title: string;
  body?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface Pending extends PromptOptions {
  resolve: (value: string | null) => void;
}

interface PromptStore {
  pending: Pending | null;
}

export const usePromptStore = create<PromptStore>(() => ({ pending: null }));

/**
 * Styled replacement for `window.prompt` — resolves the trimmed entered string,
 * or `null` if cancelled / left empty. Rendered by `<PromptHost>` (mounted once
 * in Layout). Named `promptText` to avoid clashing with the global `prompt` and
 * the app's heavily-overloaded "prompt" (generation) terminology.
 */
export function promptText(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    usePromptStore.setState({ pending: { ...options, resolve } });
  });
}
