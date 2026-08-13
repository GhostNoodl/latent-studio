import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

interface State {
  error?: Error;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ui] unrecoverable render error", error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--color-ink)] p-6 text-[var(--color-text)]">
        <div className="w-full max-w-lg rounded-[var(--radius-lg)] border border-[var(--color-danger)]/30 bg-[var(--color-surface)] p-6">
          <AlertTriangle className="h-6 w-6 text-[var(--color-danger)]" />
          <h1 className="mt-4 font-display text-xl font-semibold">Latent hit a display error</h1>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            Your generation queue is still handled by the backend. Reload the interface to reconnect.
          </p>
          <pre className="mt-4 max-h-32 overflow-auto rounded-[var(--radius-sm)] bg-[var(--color-ink)] p-3 text-xs text-[var(--color-danger)]">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-4 py-2 text-sm font-semibold text-[var(--color-on-amber)]"
          >
            <RotateCw className="h-4 w-4" /> Reload Latent
          </button>
        </div>
      </main>
    );
  }
}
