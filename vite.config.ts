import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import manifest from "./manifest.json";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        history: resolve(projectRoot, "history.html"),
        offscreen: resolve(projectRoot, "offscreen.html"),
      },
    },
  },
});
