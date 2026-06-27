import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port; when running as a plain web app (verification
// on Linux) the same config serves the SPA so browserMock can stand in for the
// Rust backend (§ plan: フロントのみ Web 起動確認).
export default defineConfig({
  plugins: [react()],
  // Relative base so the same build serves both from the Tauri custom protocol
  // and from a GitHub Pages project subpath (https://<user>.github.io/hello-world/).
  // The app has no client-side router (screens switch via store state), so a
  // single index.html with relative asset URLs resolves correctly under any prefix.
  base: "./",
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
