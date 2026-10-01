import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the build works at /<repo-name>/ on GitHub Pages
  base: "./",
  // React + MUI in one chunk is ~180 kB gzipped -- fine for a single-page tool
  build: { chunkSizeWarningLimit: 700 },
});
