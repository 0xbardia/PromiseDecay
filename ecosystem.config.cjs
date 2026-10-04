/**
 * PM2 process definitions for PromiseDecay.
 *
 * Three processes: a static file server for the built SPA, the Fastify API, and the
 * indexer worker. All bind to loopback; only nginx is public.
 *
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 */
module.exports = {
  apps: [
    {
      name: "promisedecay-web",
      script: "/root/PromiseDecay/apps/web/server/index.mjs",
      cwd: "/root/PromiseDecay",
      env: { WEB_PORT: "4180", WEB_HOST: "127.0.0.1", NODE_ENV: "production" },
      max_memory_restart: "300M",
      error_file: "/root/.pm2/logs/promisedecay-web-error.log",
      out_file: "/root/.pm2/logs/promisedecay-web-out.log",
      time: true,
    },
    {
      name: "promisedecay-api",
      // Absolute path: `cwd` already points at the package, so a relative script would
      // resolve twice.
      // Dedicated entrypoint (dist/main.js), not server.js: a process manager runs this
      // module inside its own fork, so argv-based entrypoint detection cannot work.
      script: "/root/PromiseDecay/apps/api/dist/main.js",
      cwd: "/root/PromiseDecay/apps/api",
      // Port comes from the same environment file the app reads, so there is one
      // source of truth and no duplicated literal.
      env: { NODE_ENV: "production", API_PORT: process.env.API_PORT ?? "4182", API_HOST: "127.0.0.1" },
      max_memory_restart: "400M",
      error_file: "/root/.pm2/logs/promisedecay-api-error.log",
      out_file: "/root/.pm2/logs/promisedecay-api-out.log",
      time: true,
    },
    {
      name: "promisedecay-indexer",
      script: "/root/PromiseDecay/apps/indexer/dist/worker.js",
      cwd: "/root/PromiseDecay/apps/indexer",
      env: { NODE_ENV: "production" },
      max_memory_restart: "300M",
      // Restart with a delay: a failed index pass should back off, not spin.
      restart_delay: 10000,
      error_file: "/root/.pm2/logs/promisedecay-indexer-error.log",
      out_file: "/root/.pm2/logs/promisedecay-indexer-out.log",
      time: true,
    },
  ],
};
