import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { useWs } from "@/lib/ws";
import { usePrefs } from "@/lib/prefs";
import { useNotifications } from "@/lib/notifications";
import { applyTheme, resolveTheme } from "@/lib/theme";

const GeneratePage = lazy(() => import("@/pages/GeneratePage").then((m) => ({ default: m.GeneratePage })));
const PipelinePage = lazy(() => import("@/pages/PipelinePage").then((m) => ({ default: m.PipelinePage })));
const GalleryPage = lazy(() => import("@/pages/GalleryPage").then((m) => ({ default: m.GalleryPage })));
const ModelsPage = lazy(() => import("@/pages/ModelsPage").then((m) => ({ default: m.ModelsPage })));
const DiscoverPage = lazy(() => import("@/pages/DiscoverPage").then((m) => ({ default: m.DiscoverPage })));
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));

export function App() {
  const connect = useWs((s) => s.connect);
  const onRecord = useWs((s) => s.onRecord);
  const onDownload = useWs((s) => s.onDownload);
  const connectionEpoch = useWs((s) => s.connectionEpoch);
  const addNotif = useNotifications((s) => s.add);
  const queryClient = useQueryClient();
  const themeId = usePrefs((s) => s.themeId);
  const customPrimary = usePrefs((s) => s.customPrimary);

  // Apply the accent theme (and re-apply live when it changes).
  useEffect(() => {
    const { primary, secondary } = resolveTheme(themeId, customPrimary);
    applyTheme(primary, secondary);
  }, [themeId, customPrimary]);

  useEffect(() => {
    connect();
    // Any finalized generation refreshes the gallery cache; failures notify.
    return onRecord((rec) => {
      queryClient.invalidateQueries({ queryKey: ["generations"] });
      if (rec.status === "failed") {
        addNotif({
          status: "error",
          title: "Generation failed",
          body: rec.error ?? rec.pipelineName,
          sourceId: rec.id,
        });
      }
    });
  }, [connect, onRecord, queryClient, addNotif]);

  useEffect(() => {
    if (connectionEpoch === 0) return;
    queryClient.invalidateQueries({ queryKey: ["generations"] });
    queryClient.invalidateQueries({ queryKey: ["queue"] });
    queryClient.invalidateQueries({ queryKey: ["downloads"] });
  }, [connectionEpoch, queryClient]);

  useEffect(() => {
    const report = (event: Event) => {
      const detail = (event as CustomEvent<{ message: string; path: string }>).detail;
      addNotif({ status: "error", title: "Request failed", body: detail.message });
    };
    window.addEventListener("latent:api-error", report);
    return () => window.removeEventListener("latent:api-error", report);
  }, [addNotif]);

  useEffect(() => {
    // A completed download refreshes the installed-model catalog + notifies.
    return onDownload((job) => {
      if (job.status === "completed") {
        queryClient.invalidateQueries({ queryKey: ["models"] });
        queryClient.invalidateQueries({ queryKey: ["model-folders"] });
        addNotif({
          status: "success",
          title: `Downloaded ${job.name}`,
          body: `${job.kind} · added to your library`,
          sourceId: job.id,
        });
      } else if (job.status === "failed") {
        addNotif({
          status: "error",
          title: "Download failed",
          body: `${job.name}${job.error ? ` — ${job.error}` : ""}`,
          sourceId: job.id,
        });
      } else if (job.status === "canceled") {
        addNotif({
          status: "info",
          title: "Download canceled",
          body: job.name,
          sourceId: job.id,
        });
      }
    });
  }, [onDownload, queryClient, addNotif]);

  return (
    <>
      <Layout>
        <Suspense fallback={<div className="p-8 text-sm text-[var(--color-muted)]">Loading view…</div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/generate" replace />} />
            <Route path="/generate" element={<GeneratePage />} />
            <Route path="/generate/:id" element={<PipelinePage />} />
            <Route path="/gallery" element={<GalleryPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/discover" element={<DiscoverPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/generate" replace />} />
          </Routes>
        </Suspense>
      </Layout>
    </>
  );
}
