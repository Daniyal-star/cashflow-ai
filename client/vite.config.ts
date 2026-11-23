import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

const clientDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: clientDir,
  plugins: [react()],
  css: {
    postcss: {
      plugins: [
        tailwindcss({ config: path.resolve(clientDir, "tailwind.config.js") }),
        autoprefixer(),
      ],
    },
  },
  server: {
    proxy: { "/api": "http://localhost:4000" },
  },
  build: {
    outDir: path.resolve(clientDir, "../dist/client"),
    emptyOutDir: true,
  },
});

