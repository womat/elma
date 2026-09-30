import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const backend = process.env.BACKEND_DEV_URL ?? "http://localhost:3000";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "ELMA – Energie Lokal Miteinander Austauschen",
        short_name: "ELMA",
        description: "Zeigt den aktuellen Stromüberschuss deiner Energie-Partner an.",
        lang: "de",
        start_url: "/",
        display: "standalone",
        background_color: "#0f1f17",
        theme_color: "#0f1f17",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Push-Empfang und Klick auf Nachrichten
        importScripts: ["push-sw.js"],
        // API und WebSockets nie aus dem Cache bedienen
        navigateFallbackDenylist: [/^\/api\//, /^\/live/, /^\/ingest/],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": backend,
      "/live": { target: backend.replace(/^http/, "ws"), ws: true },
    },
  },
});
