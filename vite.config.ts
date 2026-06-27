import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port; when running as a plain web app (verification
// on Linux) the same config serves the SPA so browserMock can stand in for the
// Rust backend (§ plan: フロントのみ Web 起動確認).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5180,
    strictPort: true,
  },
  build: {
    target: "es2021",
    sourcemap: true,
  },
});
