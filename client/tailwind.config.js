/** @type {import('tailwindcss').Config} */
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const toPosix = (p) => p.replace(/\\/g, "/");

export default {
  content: [
    toPosix(path.join(here, "index.html")),
    toPosix(path.join(here, "src", "**", "*.{ts,tsx}")),
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: "#070d1a",
          900: "#0b1426",
          800: "#111d35",
          700: "#1a2947",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
