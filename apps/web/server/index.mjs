/**
 * Production static server for the built web app.
 *
 * Deliberately dependency-free: it serves the Vite build, applies the security headers
 * that matter for this app, and does nothing else. nginx terminates TLS in front of it.
 *
 *   - Hashed assets are cached immutably for a year.
 *   - HTML is never cached, so a deploy is visible immediately.
 *   - Unknown paths fall through to index.html because this is a client-routed SPA.
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, "../dist");

const PORT = Number(process.env.WEB_PORT ?? 4180);
const HOST = process.env.WEB_HOST ?? "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

/**
 * Content-Security-Policy.
 *
 * `script-src 'self'` with no unsafe-inline or unsafe-eval: the app ships no inline
 * script and needs no eval. `style-src` allows 'unsafe-inline' because React sets
 * inline style attributes for the status colours; `img-src` allows data: for icons.
 * `frame-ancestors 'none'` is the clickjacking defence.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://studio.genlayer.com https://explorer-studio.genlayer.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

function securityHeaders() {
  return {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...securityHeaders(), ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method Not Allowed", { "Content-Type": "text/plain", Allow: "GET, HEAD" });
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  // Normalise and contain the path: no traversal out of dist.
  const decoded = decodeURIComponent(url.pathname);
  const candidate = path.normalize(path.join(DIST, decoded));

  if (!candidate.startsWith(DIST)) {
    send(res, 403, "Forbidden", { "Content-Type": "text/plain" });
    return;
  }

  let filePath = candidate;
  let stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  if (stat?.isDirectory()) {
    filePath = path.join(filePath, "index.html");
    stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  }

  // Client-side route: serve the shell and let the router take over.
  if (!stat || !stat.isFile()) {
    const shell = path.join(DIST, "index.html");
    if (!fs.existsSync(shell)) {
      send(res, 500, "Build not found. Run pnpm --filter @promisedecay/web build.", {
        "Content-Type": "text/plain",
      });
      return;
    }
    const html = fs.readFileSync(shell);
    send(res, 200, req.method === "HEAD" ? "" : html, {
      "Content-Type": MIME[".html"],
      // HTML must never be cached or a deploy would not be visible.
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const isHashedAsset = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\./.test(filePath);

  send(res, 200, req.method === "HEAD" ? "" : fs.readFileSync(filePath), {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Cache-Control": isHashedAsset
      ? "public, max-age=31536000, immutable"
      : "public, max-age=3600",
  });
});

server.listen(PORT, HOST, () => {
  console.log(`promisedecay-web listening on http://${HOST}:${PORT} (serving ${DIST})`);
});

const shutdown = () => {
  console.log("promisedecay-web shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);