import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

if ("serviceWorker" in navigator) {
  // The worker serves the app from its cache, so a freshly deployed version only shows
  // after the new worker takes over AND the page loads again. Do that second load for the
  // user — otherwise they keep seeing the previous build (and its missing screens).
  const hadWorker = navigator.serviceWorker.controller !== null;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadWorker || reloaded) return; // first install: nothing stale to replace
    const active = document.activeElement;
    // Never reload under someone's typing; the next page load picks the new version up.
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
    reloaded = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").then((registration) => {
      // An installed app can stay open for days; look for a new version whenever it comes back to the front.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void registration.update().catch(() => undefined);
      });
    });
  });
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
