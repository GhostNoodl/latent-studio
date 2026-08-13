import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";

type State = "checking" | "pairing" | "ready" | "locked";

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("checking");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const status = await api.authStatus();
        if (!active) return;
        if (status.authenticated) {
          setState("ready");
          return;
        }

        const url = new URL(window.location.href);
        const supplied = url.searchParams.get("token");
        if (!supplied) {
          setState("locked");
          return;
        }

        setState("pairing");
        url.searchParams.delete("token");
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
        await api.createSession(supplied);
        if (active) setState("ready");
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
        setState("locked");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token.trim()) return;
    setError("");
    setState("pairing");
    try {
      await api.createSession(token.trim());
      setToken("");
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("locked");
    }
  }

  if (state === "ready") return children;

  if (state === "checking" || state === "pairing") {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--color-ink)] text-[var(--color-muted)]">
        <div className="flex items-center gap-2 text-sm" role="status">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--color-amber)]" />
          {state === "checking" ? "Opening Latent…" : "Pairing this browser…"}
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--color-ink)] p-5 text-[var(--color-text)]">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-2xl"
      >
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-amber)]/10 text-[var(--color-amber)]">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <h1 className="font-display text-xl font-semibold">Pair with Latent</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
          Enter the LAN pairing token stored in <span className="text-[var(--color-text)]">data/access-token</span> on the computer running Latent.
        </p>
        <label htmlFor="pairing-token" className="mt-5 block text-xs font-medium text-[var(--color-muted)]">
          Pairing token
        </label>
        <div className="mt-1.5 flex items-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-ink)] px-3 focus-within:border-[var(--color-amber)]">
          <KeyRound className="mr-2 h-4 w-4 shrink-0 text-[var(--color-faint)]" />
          <input
            id="pairing-token"
            type="password"
            autoComplete="off"
            autoFocus
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none"
          />
        </div>
        {error && <p className="mt-2 text-xs text-[var(--color-danger)]" role="alert">{error}</p>}
        <button
          type="submit"
          disabled={!token.trim()}
          className="mt-4 w-full rounded-[var(--radius-sm)] bg-[var(--color-amber)] px-4 py-2.5 text-sm font-semibold text-[var(--color-on-amber)] transition-opacity disabled:opacity-40"
        >
          Pair browser
        </button>
      </form>
    </main>
  );
}
