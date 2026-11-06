import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/registry/",
  envDir: path.resolve(__dirname, "../.."),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@ai-trust/react-hooks": path.resolve(__dirname, "../../libs/react-hooks/src"),
      "@questionnaire": path.resolve(__dirname, "../../context/prompts/ai-questionnaire.json"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 3001,
  },
});
