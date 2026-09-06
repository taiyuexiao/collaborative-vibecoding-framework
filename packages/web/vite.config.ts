import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 7301,
    proxy: {
      "/api": "http://127.0.0.1:7300",
      "/ws": { target: "ws://127.0.0.1:7300", ws: true },
    },
  },
});
