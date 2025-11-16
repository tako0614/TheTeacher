import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  build: {
    target: "esnext",
  },
});
