import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { BootScreen } from "@/components/BootScreen";
import { GeneratePage } from "@/pages/GeneratePage";
import { PipelinePage } from "@/pages/PipelinePage";
import { GalleryPage } from "@/pages/GalleryPage";
import { ModelsPage } from "@/pages/ModelsPage";
import { DiscoverPage } from "@/pages/DiscoverPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { useWs } from "@/lib/ws";
import { usePrefs } from "@/lib/prefs";
import { useNotifications } from "@/lib/notifications";
import { applyTheme, resolveTheme } from "@/lib/theme";

export function App() {
  const connect = useWs((s) => s.connect);
  const onRecord = useWs((s) => s.onRecord);
  const onDownload = useWs((s) => s.onDownload);
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
      <BootScreen />
      <Layout>
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
      </Layout>
    </>
  );
}
