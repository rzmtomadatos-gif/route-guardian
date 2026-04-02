import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// ── PWA Service Worker management ────────────────────────────────
// In preview/iframe contexts: unregister any stale SW.
// In production (published domain): register the SW for offline support.

const isInIframe = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin → assume iframe
  }
})();

const isPreviewHost =
  window.location.hostname.includes("id-preview--") ||
  window.location.hostname.includes("lovableproject.com");

if (isPreviewHost || isInIframe) {
  // Unregister any existing service workers in preview/iframe contexts
  navigator.serviceWorker?.getRegistrations().then((registrations) => {
    registrations.forEach((r) => r.unregister());
  });
} else {
  // Production: explicitly register the PWA service worker.
  // We use manual registration (injectRegister: false in vite config)
  // so we have full control over when and where the SW activates.
  import("virtual:pwa-register").then(({ registerSW }) => {
    const updateSW = registerSW({
      immediate: true,
      onRegisteredSW(swUrl, registration) {
        console.log("[PWA] Service Worker registered:", swUrl);
        // Check for updates every 60 minutes
        if (registration) {
          setInterval(() => {
            registration.update();
          }, 60 * 60 * 1000);
        }
      },
      onOfflineReady() {
        console.log("[PWA] App is ready for offline use");
      },
      onNeedRefresh() {
        // Auto-update: apply immediately
        console.log("[PWA] New content available, updating...");
        updateSW(true);
      },
      onRegisterError(error) {
        console.error("[PWA] Service Worker registration failed:", error);
      },
    });
  }).catch((err) => {
    // In dev builds, virtual:pwa-register won't exist — ignore silently
    console.debug("[PWA] SW registration skipped (dev mode or unavailable)", err);
  });
}

createRoot(document.getElementById("root")!).render(<App />);
