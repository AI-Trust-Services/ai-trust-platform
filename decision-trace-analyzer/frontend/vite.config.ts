import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/dta/",
  server: {
    port: 3005,
    proxy: {
      "/api": {
        target: "http://localhost:8006",
        changeOrigin: true,
      },
    },
  },
});
