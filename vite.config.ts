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
      // We handle registration manually in main.tsx for precise control
      // over preview vs production contexts.
      injectRegister: false,
      devOptions: {
        enabled: false, // NEVER enable in dev — breaks Lovable preview iframes
      },
      includeAssets: [
        "robots.txt",
        "manifest.json",
      ],
      manifest: false, // We provide our own public/manifest.json
      workbox: {
        globPatterns: [
          "**/*.{js,css,html,ico,png,svg,woff,woff2}",
        ],
        // Keep the WASM binary in precache exactly once.
        // Public icons/favicon/placeholder are already covered by globPatterns.
        additionalManifestEntries: [
          { url: "sql-wasm.wasm", revision: "3" },
        ],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/~oauth/],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10 MB for WASM
        // Runtime caching: catch anything that slips through precache
        runtimeCaching: [
          {
            // Cache the manifest.json at runtime too
            urlPattern: /\/manifest\.json$/,
            handler: "CacheFirst",
            options: {
              cacheName: "pwa-manifest",
              expiration: { maxEntries: 1, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            // Cache any PNG/SVG icons that might be requested
            urlPattern: /\/pwa-.*\.png$/,
            handler: "CacheFirst",
            options: {
              cacheName: "pwa-icons",
              expiration: { maxEntries: 10, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            // Cache map tiles with network-first strategy (useful while online,
            // graceful failure when offline)
            urlPattern: /basemaps\.cartocdn\.com/,
            handler: "CacheFirst",
            options: {
              cacheName: "map-tiles",
              expiration: {
                maxEntries: 5000,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
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
