import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/risk-management/",
  server: {
    port: 3009,
    proxy: {
      "/api/risk-management": "http://localhost:8080",
    },
  },
});
