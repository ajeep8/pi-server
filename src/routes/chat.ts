import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SessionManager } from "../session/session-manager.js";
import { extractLatestUserMessage, buildFullPrompt } from "../session/session-manager.js";
import { StreamFormatter } from "../openai/formatter.js";
import { ResponseBuilder } from "../openai/response-builder.js";
import type { ChatCompletionRequest, OpenAIMessage } from "../openai/types.js";
import type { AgentEvent, ExtensionUIRequest, RpcResponse } from "../rpc/protocol.js";
import type { RpcBridge } from "../rpc/rpc-bridge.js";
import type { Adapter } from "../adapters/types.js";

export function createChatRoutes(sessionManager: SessionManager, adapter: Adapter): Hono {
  const app = new Hono();

  app.post("/v1/chat/completions", async (c) => {
    const body = await c.req.json<ChatCompletionRequest>();

    if (!body.messages?.length) {
      return c.json({ error: { message: "messages is required", type: "invalid_request_error", code: "missing_field" } }, 400);
    }

    const sessionId = c.req.header("x-session-id") ?? null;
    const isSessionMode = sessionId !== null;
    const { bridge, sessionId: resolvedSessionId, isNew } = sessionManager.getOrCreate(sessionId);

    if (!bridge.alive) {
      return c.json({ error: { message: "Failed to start agent process", type: "server_error", code: "process_error" } }, 500);
    }

    // Check if this is a tool result for a pending UI request
    const toolResultMessage = findToolResultMessage(body.messages);
    if (toolResultMessage && bridge.waitingUI) {
      return handleUIResponse(c, bridge, toolResultMessage, resolvedSessionId, body, adapter);
    }

    if (bridge.busy || bridge.waitingUI) {
      return c.json({ error: { message: "Session is busy processing another request", type: "rate_limit_error", code: "session_busy" } }, 429);
    }

    let promptText: string;
    let images: Array<{ type: "image"; data: string; mimeType: string }> | undefined;

    if (isSessionMode) {
      const extracted = extractLatestUserMessage(body.messages);
      promptText = extracted.text;
      images = extracted.images.length > 0 ? extracted.images : undefined;
      if (isNew && extracted.systemPrompt) {
        promptText = `${extracted.systemPrompt}\n\n${promptText}`;
      }
    } else {
      promptText = buildFullPrompt(body.messages);
    }

    if (!promptText.trim()) {
      return c.json({ error: { message: "No user message found", type: "invalid_request_error", code: "missing_message" } }, 400);
    }

    const model = body.model ?? "pi-agent";

    if (body.stream) {
      return handleStreaming(c, bridge, promptText, images, model, resolvedSessionId, adapter);
    }

    return handleNonStreaming(c, bridge, promptText, images, model, resolvedSessionId, adapter);
  });

  return app;
}

function findToolResultMessage(messages: OpenAIMessage[]): OpenAIMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "tool" && messages[i].tool_call_id) {
      return messages[i];
    }
  }
  return null;
}

async function handleUIResponse(
  c: any,
  bridge: RpcBridge,
  toolResult: OpenAIMessage,
  sessionId: string,
  body: ChatCompletionRequest,
  adapter: Adapter,
) {
  const uiRequestId = toolResult.tool_call_id!;
  const resultContent = typeof toolResult.content === "string" ? toolResult.content : "";

  bridge.respondToUIRequest(uiRequestId, resultContent);

  const model = body.model ?? "pi-agent";

  if (body.stream) {
    return streamSSE(c, async (stream) => {
      const formatter = new StreamFormatter(model, adapter);

      const { cleanup, promise } = waitForCompletionOrUI(bridge, {
        onEvent(event) {
          const formatted = formatter.formatEvent(event);
          if (formatted) {
            const jsonStr = formatted.replace(/^data: /, "").replace(/\n\n$/, "");
            stream.writeSSE({ data: jsonStr }).catch(() => {});
          }
        },
        onUIRequest(request) {
          const formatted = formatter.formatUIRequest(request);
          const parts = formatted.split("\n\n").filter(Boolean);
          for (const part of parts) {
            const jsonStr = part.replace(/^data: /, "");
            stream.writeSSE({ data: jsonStr }).catch(() => {});
          }
        },
        onFireForget(request) {
          const formatted = formatter.formatFireForget(request);
          const parts = formatted.split("\n\n").filter(Boolean);
          for (const part of parts) {
            const jsonStr = part.replace(/^data: /, "");
            stream.writeSSE({ data: jsonStr }).catch(() => {});
          }
        },
      });

      await promise;
      cleanup();
      await stream.writeSSE({ data: "[DONE]" });
    });
  }

  // Non-streaming
  const builder = new ResponseBuilder(model, adapter);
  const { cleanup, promise } = waitForCompletionOrUI(bridge, {
    onEvent(event) { builder.processEvent(event); },
    onUIRequest(request) { builder.setUIRequest(request); },
    onFireForget(request) { builder.processFireForget(request); },
  });

  await promise;
  cleanup();
  c.header("x-session-id", sessionId);
  return c.json(builder.build());
}

function handleStreaming(
  c: any,
  bridge: RpcBridge,
  promptText: string,
  images: Array<{ type: "image"; data: string; mimeType: string }> | undefined,
  model: string,
  sessionId: string,
  adapter: Adapter,
) {
  return streamSSE(c, async (stream) => {
    const formatter = new StreamFormatter(model, adapter);

    const responsePromise = new Promise<void>((resolve) => {
      const onResponse = (resp: RpcResponse) => {
        if (resp.command === "prompt") {
          bridge.removeListener("response", onResponse);
          resolve();
        }
      };
      bridge.on("response", onResponse);
    });

    const { cleanup, promise } = waitForCompletionOrUI(bridge, {
      onEvent(event) {
        const formatted = formatter.formatEvent(event);
        if (formatted) {
          const jsonStr = formatted.replace(/^data: /, "").replace(/\n\n$/, "");
          stream.writeSSE({ data: jsonStr }).catch(() => {});
        }
      },
      onUIRequest(request) {
        const formatted = formatter.formatUIRequest(request);
        const parts = formatted.split("\n\n").filter(Boolean);
        for (const part of parts) {
          const jsonStr = part.replace(/^data: /, "");
          stream.writeSSE({ data: jsonStr }).catch(() => {});
        }
      },
      onFireForget(request) {
        const formatted = formatter.formatUIRequest(request);
        const parts = formatted.split("\n\n").filter(Boolean);
        for (const part of parts) {
          const jsonStr = part.replace(/^data: /, "");
          stream.writeSSE({ data: jsonStr }).catch(() => {});
        }
      },
    });

    bridge.sendPrompt(promptText, images);
    await responsePromise;
    await promise;
    cleanup();
    await stream.writeSSE({ data: "[DONE]" });
  });
}

async function handleNonStreaming(
  c: any,
  bridge: RpcBridge,
  promptText: string,
  images: Array<{ type: "image"; data: string; mimeType: string }> | undefined,
  model: string,
  sessionId: string,
  adapter: Adapter,
) {
  const builder = new ResponseBuilder(model, adapter);

  const { cleanup, promise } = waitForCompletionOrUI(bridge, {
    onEvent(event) { builder.processEvent(event); },
    onUIRequest(request) { builder.setUIRequest(request); },
    onFireForget(request) { builder.processFireForget(request); },
  });

  bridge.sendPrompt(promptText, images);
  await promise;
  cleanup();

  c.header("x-session-id", sessionId);
  return c.json(builder.build());
}

function waitForCompletionOrUI(
  bridge: RpcBridge,
  handlers: {
    onEvent: (event: AgentEvent) => void;
    onUIRequest: (request: ExtensionUIRequest) => void;
    onFireForget?: (request: ExtensionUIRequest) => void;
  },
): { cleanup: () => void; promise: Promise<void> } {
  let onEvent: (event: AgentEvent) => void;
  let onUIRequest: (request: ExtensionUIRequest) => void;
  let onFireForget: ((request: ExtensionUIRequest) => void) | undefined;
  let timeout: ReturnType<typeof setTimeout>;

  const promise = new Promise<void>((resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error("Request timed out"));
    }, getRequestTimeoutMs());

    onEvent = (event: AgentEvent) => {
      handlers.onEvent(event);
      if (event.type === "agent_end") {
        clearTimeout(timeout);
        resolve();
      }
    };

    onUIRequest = (request: ExtensionUIRequest) => {
      clearTimeout(timeout);
      handlers.onUIRequest(request);
      resolve();
    };

    onFireForget = handlers.onFireForget;

    bridge.on("event", onEvent);
    bridge.on("extension_ui_request", onUIRequest);
    if (onFireForget) {
      bridge.on("extension_ui_fire_forget", onFireForget);
    }
  });

  const cleanup = () => {
    clearTimeout(timeout!);
    bridge.removeListener("event", onEvent!);
    bridge.removeListener("extension_ui_request", onUIRequest!);
    if (onFireForget) {
      bridge.removeListener("extension_ui_fire_forget", onFireForget);
    }
  };

  return { cleanup, promise };
}

function getRequestTimeoutMs(): number {
  const raw = process.env.REQUEST_TIMEOUT_MS;
  if (!raw) return 1800000; // 30 minutes
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1800000;
}
