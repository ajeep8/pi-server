import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";

const config = loadConfig();
const { app, processManager } = createApp(config);

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[pi-server] Listening on http://localhost:${info.port}`);
  console.log(`[pi-server] Agent binary: ${config.agentBinary}`);
  console.log(`[pi-server] Agent CWD: ${config.agentCwd}`);
  console.log(`[pi-server] Max sessions: ${config.maxSessions}, TTL: ${config.sessionTtlMs}ms`);
  if (config.authToken) {
    console.log(`[pi-server] Auth: enabled`);
  }
});

function shutdown() {
  console.log("\n[pi-server] Shutting down...");
  processManager.stop();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
