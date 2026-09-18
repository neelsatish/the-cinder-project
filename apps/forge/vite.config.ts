import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { strictPort: true, host: "127.0.0.1", port: 5175 },
  envPrefix: ["VITE_", "TAURI_"],
  // Installed desktop app loading from disk, not over a network: the lazily
  // loaded editor and document libraries sit just above Vite's 500 kB web default.
  build: { target: "es2021", minify: "esbuild", sourcemap: false, chunkSizeWarningLimit: 700 },
});
