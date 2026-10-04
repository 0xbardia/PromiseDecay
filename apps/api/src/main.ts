/**
 * API entrypoint.
 *
 * A dedicated file rather than a `process.argv[1]` guard inside server.ts: a process
 * manager executes this module inside its own fork wrapper, so `process.argv[1]` is the
 * manager's file, not this one. Any check of the form "am I the entrypoint?" therefore
 * evaluates false under PM2, and the API silently starts without binding a port.
 *
 * This file unconditionally starts the server, so behaviour is identical under node, tsx
 * and a process manager.
 */
import { startServer } from "./server.js";

await startServer();