import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Config } from "./config.js";
import { ProcessManager } from "./rpc/process-manager.js";
import { SessionManager } from "./session/session-manager.js";
import { authMiddleware } from "./middleware/auth.js";
import { errorMiddleware } from "./middleware/error.js";
import { healthRoutes } from "./routes/health.js";
import { modelsRoutes } from "./routes/models.js";
import { createChatRoutes } from "./routes/chat.js";

export interface AppContext {
  app: Hono;
  processManager: ProcessManager;
  sessionManager: SessionManager;
}

export function createApp(config: Config): AppContext {
  const app = new Hono();
  const processManager = new ProcessManager(config);
  const sessionManager = new SessionManager(processManager);

  app.use("*", cors());
  app.use("*", errorMiddleware);
  app.use("*", authMiddleware(config.authToken));

  app.route("/", healthRoutes);
  app.route("/", modelsRoutes);
  app.route("/", createChatRoutes(sessionManager));

  // Session management endpoints
  app.get("/v1/sessions", (c) => {
    return c.json({ sessions: processManager.listSessions() });
  });

  app.delete("/v1/sessions/:id", (c) => {
    const id = c.req.param("id");
    processManager.destroy(id);
    return c.json({ deleted: true });
  });

  processManager.start();

  return { app, processManager, sessionManager };
}
