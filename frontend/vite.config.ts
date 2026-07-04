import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

const BACKEND = "http://127.0.0.1:4000";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Localhost tool → no offline use. A cached service worker kept serving
      // stale builds (old startup gate). selfDestroying ships a SW that unregisters
      // itself + clears all caches, so the browser always loads fresh from the backend.
      selfDestroying: true,
      registerType: "autoUpdate",
      includeAssets: ["latent-icon.svg"],
      // Generates 192/512/maskable/apple-touch PNGs from the source icon
      // and injects the matching manifest + <link> tags.
      pwaAssets: { image: "public/latent-icon.svg" },
      manifest: {
        name: "Latent — ComfyUI Studio",
        short_name: "Latent",
        description: "A personal studio for ComfyUI — image & video generation.",
        theme_color: "#0e1116",
        background_color: "#0e1116",
        display: "standalone",
        start_url: "/",
        scope: "/",
        categories: ["graphics", "productivity"],
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Outputs/videos are served by the backend, never precache them.
        navigateFallbackDenylist: [/^\/api/, /^\/outputs/, /^\/ws/],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: BACKEND, changeOrigin: true },
      "/outputs": { target: BACKEND, changeOrigin: true },
      "/ws": { target: BACKEND, ws: true, changeOrigin: true },
    },
  },
});
