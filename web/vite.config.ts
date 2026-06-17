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
      manifest: {
        name: "Cairn",
        short_name: "Cairn",
        description: "Local-first intention and schedule tracking",
        start_url: "/today",
        scope: "/",
        display: "standalone",
        background_color: "#0E1418",
        theme_color: "#E0B250",
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
