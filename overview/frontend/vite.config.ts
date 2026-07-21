import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  // Load env vars from the repo root so all frontends share one `.env`.
  // In the Docker build there is no root `.env` in the image — the required
  // VITE_* vars are passed as ARG/ENV build args and Vite reads them from the
  // process environment instead. Running `vite build` locally from this dir
  // therefore requires the repo-root `.env` to be present.
  envDir: path.resolve(__dirname, "../.."),
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 3003,
  },
});
