import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Where the dev/preview server proxies API calls. Defaults to the local
// API; override with VITE_PROXY_TARGET when the API runs elsewhere.
const proxyTarget = process.env.VITE_PROXY_TARGET || "http://localhost:3001";

// Hostnames the dev/preview server will answer for. Vite rejects requests
// whose Host header it does not recognise, which otherwise shows up as
// "Blocked request. This host is not allowed" when serving on a domain.
const allowedHosts = ["localhost", "127.0.0.1", "vantage-fleet.duckdns.org"];

const proxy = {
  "/auth": { target: proxyTarget, changeOrigin: true },
  "/api": { target: proxyTarget, changeOrigin: true },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Bind all interfaces so the server is reachable from outside the host.
    host: true,
    allowedHosts,
    proxy,
  },
  preview: {
    port: 5173,
    host: true,
    allowedHosts,
    proxy,
  },
});
