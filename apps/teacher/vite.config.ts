import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { strictPort: true, host: "127.0.0.1", port: 5174 },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: "es2021", minify: "esbuild", sourcemap: false },
});
