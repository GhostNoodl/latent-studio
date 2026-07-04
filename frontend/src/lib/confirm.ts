import { create } from "zustand";

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

interface ConfirmStore {
  pending: Pending | null;
}

export const useConfirmStore = create<ConfirmStore>(() => ({ pending: null }));

/** Styled replacement for window.confirm — resolves true on confirm, false otherwise. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.setState({ pending: { ...options, resolve } });
  });
}
