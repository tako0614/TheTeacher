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
    rollupOptions: {
      output: {
        // Code splitting for better caching and smaller initial bundle
        manualChunks: {
          // Heavy libraries in separate chunks
          "vendor-mermaid": ["mermaid"],
          "vendor-pdf": ["pdfjs-dist"],
          "vendor-katex": ["katex"],
          // Core UI framework
          "vendor-solid": ["solid-js", "@solidjs/router"],
          // Shared utilities
          "vendor-zod": ["zod"],
        },
      },
    },
    // Enable chunk size warnings
    chunkSizeWarningLimit: 500,
  },
  // Optimize dependency pre-bundling
  optimizeDeps: {
    include: ["solid-js", "@solidjs/router", "zod"],
    // Exclude heavy libs from pre-bundling (loaded on demand)
    exclude: ["mermaid", "pdfjs-dist"],
  },
});
