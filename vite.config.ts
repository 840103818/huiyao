import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2022",
    sourcemap: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          minSize: 20_000,
          maxSize: 450_000,
          groups: [
            { name: "arco", test: /node_modules\/@arco-design\//, maxSize: 400_000 },
            { name: "react", test: /node_modules\/(react|react-dom|scheduler)\// },
            { name: "tauri", test: /node_modules\/@tauri-apps\// },
          ],
        },
      },
    },
  },
});
