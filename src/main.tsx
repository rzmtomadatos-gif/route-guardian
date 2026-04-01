import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// ── PWA Service Worker guard ─────────────────────────────────────────
// Never register SW inside iframes or Lovable preview hosts — it would
// cache stale content and break the editor preview.
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
}

createRoot(document.getElementById("root")!).render(<App />);
