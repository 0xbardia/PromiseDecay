import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Production build configuration.
 *
 * Deliberately minimal: no animation library, no canvas loop, no icon pack. Motion is CSS
 * only, so the bundle stays small and the page has no always-running JavaScript.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: false, // do not ship source maps to production
    cssCodeSplit: true,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing vendors so the landing page stays fast.
        manualChunks: {
          react: ["react", "react-dom"],
        },
      },
    },
  },
  server: {
    port: 4180,
    strictPort: true,
    proxy: {
      // In dev, talk to the API process directly so there is no CORS or cookie detour.
      "/api": {
        // Reads the same configured port the API process uses; no duplicated literal.
        target: `http://127.0.0.1:${process.env.API_PORT ?? 4182}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4180,
    strictPort: true,
  },
});