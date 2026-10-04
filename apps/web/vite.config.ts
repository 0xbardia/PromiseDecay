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

  // Vite loads .env files from its `root`, which is this package. The single .env for the
  // whole monorepo lives at the repository root, so without this every `import.meta.env.VITE_*`
  // resolved to undefined and the built bundle silently contained no configuration at all.
  //
  // This stayed hidden because most of the values have matching defaults in chain.ts — the RPC
  // URL and chain id happened to be right — so only VITE_GENLAYER_CONTRACT_ADDRESS, which has
  // no sensible default, exposed it. The promise detail page kept showing a contract address
  // because it reads that value from the API response, not from the bundle, which made the
  // broken configuration look healthy until someone actually tried to submit a transaction.
  envDir: "../..",
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