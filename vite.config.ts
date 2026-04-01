import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: {
        enabled: false, // NEVER enable in dev — breaks Lovable preview iframes
      },
      includeAssets: [
        "sql-wasm.wasm",
        "placeholder.svg",
        "robots.txt",
        "manifest.json",
      ],
      manifest: false, // We provide our own public/manifest.json
      workbox: {
        globPatterns: [
          "**/*.{js,css,html,ico,png,svg,woff,woff2,wasm}",
        ],
        // Precache the WASM binary explicitly
        additionalManifestEntries: [
          { url: "/sql-wasm.wasm", revision: "1" },
        ],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/~oauth/],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10 MB for WASM
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    exclude: ['sql.js'],
  },
}));
