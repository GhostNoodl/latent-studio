import { useQuery } from "@tanstack/react-query";
import { Navigate, Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

/**
 * Generate landing — pipelines are tabs now, so this just routes to the first
 * pipeline's workspace (or shows an import prompt when none exist).
 */
export function GeneratePage() {
  const { data: pipelines, isLoading } = useQuery({ queryKey: ["pipelines"], queryFn: api.pipelines });

  if (isLoading) return <div className="p-8 text-sm text-[var(--color-muted)]">Loading…</div>;
  const first = pipelines?.[0];
  if (first) return <Navigate to={`/generate/${first.id}`} replace />;

  return (
    <div>
      <PageHeader eyebrow="Studio" title="Generate" />
      <div className="p-8">
        <Card className="latent-grain relative overflow-hidden">
          <div className="relative z-10 flex flex-col items-center gap-4 px-8 py-20 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-[var(--radius-lg)] bg-[var(--color-elevated)]">
              <Sparkles className="h-6 w-6 text-[var(--color-amber)]" strokeWidth={1.5} />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold">No pipelines yet</h2>
              <p className="mt-2 max-w-md text-sm text-[var(--color-muted)]">
                Import a ComfyUI workflow saved in{" "}
                <span className="text-[var(--color-text)]">API format</span> to turn its node graph
                into a clean generation form.
              </p>
            </div>
            <Link to="/settings">
              <Button variant="primary">Go to Settings</Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
