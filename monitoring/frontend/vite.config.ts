import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  base: "/monitoring/",
  envDir: path.resolve(__dirname, "../.."),
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 3002,
  },
});
