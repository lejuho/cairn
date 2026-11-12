import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:3100",
      "/health": "http://localhost:3100"
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["pwa-icon.svg"],
      workbox: {
        // Page loads are answered from the cached shell, except these: the Cloudflare
        // Access login/callback (/cdn-cgi/) and the API must reach the network, or an
        // expired session can never be renewed from inside the installed app.
        navigateFallbackDenylist: [/^\/cdn-cgi\//, /^\/api\//, /^\/health$/]
      },
      manifest: {
        name: "Cairn",
        short_name: "Cairn",
        description: "Local-first intention and schedule tracking",
        start_url: "/calendar",
        scope: "/",
        display: "standalone",
        background_color: "#f5f6f8",
        theme_color: "#2457e6",
        icons: [
          {
            src: "/pwa-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      }
    })
  ]
});
