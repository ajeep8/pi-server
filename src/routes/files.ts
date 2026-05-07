import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, basename, resolve } from "node:path";
import type { SessionManager } from "../session/session-manager.js";
import type { AgentEvent, ExtensionUIRequest, RpcResponse } from "../rpc/protocol.js";
import type { RpcBridge } from "../rpc/rpc-bridge.js";

export interface FilesRouteConfig {
  uploadDir: string;
  ingestTimeoutMs: number;
}

export function createFilesRoutes(sessionManager: SessionManager, config: FilesRouteConfig): Hono {
  const app = new Hono();

  app.post("/v1/files", async (c) => {
    const formData = await c.req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return c.json({ error: { message: "file field is required", type: "invalid_request_error", code: "missing_field" } }, 400);
    }

    const sessionId = `upload_${randomUUID()}`;
    const { bridge } = sessionManager.getOrCreate(sessionId);

    if (!bridge.alive) {
      return c.json({ error: { message: "Failed to start agent process", type: "server_error", code: "process_error" } }, 500);
    }

    const sanitizedName = basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_");
    const sessionDir = resolve(config.uploadDir, sessionId);
    const filePath = join(sessionDir, sanitizedName);

    try {
      await mkdir(sessionDir, { recursive: true });
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(filePath, buffer);
    } catch (err) {
      sessionManager.destroy(sessionId);
      return c.json({ error: { message: "Failed to save file", type: "server_error", code: "file_write_error" } }, 500);
    }

    const promptMessage = `Ingest the file at: ${filePath}`;
    console.log(`[pi-server] File upload: ${file.name} -> ${filePath}, sending to session ${sessionId}`);

    try {
      const result = await sendPromptAndWait(bridge, promptMessage, config.ingestTimeoutMs);

      await rm(sessionDir, { recursive: true, force: true }).catch(() => {});

      if (result.success) {
        return c.json({
          id: `file-${randomUUID()}`,
          object: "file",
          filename: file.name,
          bytes: file.size,
          purpose: "assistants",
          session_id: sessionId,
        });
      }

      return c.json({ error: { message: "Agent failed to ingest file", type: "server_error", code: "ingest_error" } }, 500);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await rm(sessionDir, { recursive: true, force: true }).catch(() => {});
      return c.json({ error: { message, type: "server_error", code: "ingest_error" } }, 500);
    }
  });

  return app;
}

function sendPromptAndWait(
  bridge: RpcBridge,
  message: string,
  timeoutMs: number,
): Promise<{ success: boolean }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.error(`[pi-server] File ingestion timed out. Bridge alive: ${bridge.alive}, state: ${bridge.state}`);
      cleanup();
      reject(new Error(`File ingestion timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onResponse = (resp: RpcResponse) => {
      if (resp.command === "prompt") {
        console.log(`[pi-server] File ingestion prompt accepted: ${resp.success}`);
        if (!resp.success) {
          cleanup();
          resolve({ success: false });
        }
      }
    };

    const onEvent = (event: AgentEvent) => {
      if (event.type === "agent_end") {
        console.log(`[pi-server] File ingestion completed`);
        cleanup();
        resolve({ success: true });
      }
    };

    const onUIRequest = (request: ExtensionUIRequest) => {
      console.log(`[pi-server] File ingestion: agent requested UI (${request.method}), auto-confirming`);
      bridge.respondToUIRequest(request.id, "Allow");
    };

    const onExit = () => {
      console.error(`[pi-server] Agent exited during file ingestion`);
      cleanup();
      reject(new Error("Agent process exited during file ingestion"));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      bridge.removeListener("response", onResponse);
      bridge.removeListener("event", onEvent);
      bridge.removeListener("extension_ui_request", onUIRequest);
      bridge.removeListener("exit", onExit);
    };

    bridge.on("response", onResponse);
    bridge.on("event", onEvent);
    bridge.on("extension_ui_request", onUIRequest);
    bridge.on("exit", onExit);
    bridge.sendPrompt(message);
  });
}
