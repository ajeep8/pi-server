import { randomUUID } from "node:crypto";
import type { AgentEvent, ExtensionUIRequest } from "../rpc/protocol.js";
import type { ChatCompletionChunk, ChatCompletionChunkChoice } from "./types.js";

export class StreamFormatter {
  private requestId: string;
  private model: string;
  private created: number;

  constructor(model: string) {
    this.requestId = `chatcmpl-${randomUUID()}`;
    this.model = model;
    this.created = Math.floor(Date.now() / 1000);
  }

  formatEvent(event: AgentEvent): string | null {
    switch (event.type) {
      case "agent_start":
        return this.formatChunk({ role: "assistant" }, null);

      case "message_update": {
        const ame = event.assistantMessageEvent;
        if (ame.type === "text_delta") {
          return this.formatChunk({ content: ame.delta }, null);
        }
        return null;
      }

      case "agent_end":
        return this.formatChunk({}, "stop");

      default:
        return null;
    }
  }

  formatUIRequest(request: ExtensionUIRequest): string {
    const toolCall = extensionUIToToolCall(request);
    const chunk: ChatCompletionChunk = {
      id: this.requestId,
      object: "chat.completion.chunk",
      created: this.created,
      model: this.model,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{
              id: toolCall.id,
              type: "function",
              function: toolCall.function,
            }],
          },
          finish_reason: null,
        },
      ],
    };
    const deltaChunk = `data: ${JSON.stringify(chunk)}\n\n`;

    const finishChunk: ChatCompletionChunk = {
      id: this.requestId,
      object: "chat.completion.chunk",
      created: this.created,
      model: this.model,
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    };
    return deltaChunk + `data: ${JSON.stringify(finishChunk)}\n\n`;
  }

  formatDone(): string {
    return "data: [DONE]\n\n";
  }

  private formatChunk(
    delta: ChatCompletionChunkChoice["delta"],
    finishReason: "stop" | "length" | "tool_calls" | null,
  ): string {
    const chunk: ChatCompletionChunk = {
      id: this.requestId,
      object: "chat.completion.chunk",
      created: this.created,
      model: this.model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    };
    return `data: ${JSON.stringify(chunk)}\n\n`;
  }

  getRequestId(): string {
    return this.requestId;
  }
}

export function extensionUIToToolCall(request: ExtensionUIRequest): {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
} {
  return {
    id: request.id,
    type: "function",
    function: {
      name: `extension_ui_${request.method}`,
      arguments: JSON.stringify(request.params ?? {}),
    },
  };
}
