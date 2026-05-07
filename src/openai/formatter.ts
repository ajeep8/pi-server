import { randomUUID } from "node:crypto";
import type { AgentEvent, ExtensionUIRequest } from "../rpc/protocol.js";
import type { ChatCompletionChunk, ChatCompletionChunkChoice } from "./types.js";
import type { Adapter } from "../adapters/types.js";

export class StreamFormatter {
  private requestId: string;
  private model: string;
  private created: number;
  private adapter: Adapter;

  constructor(model: string, adapter: Adapter) {
    this.requestId = `chatcmpl-${randomUUID()}`;
    this.model = model;
    this.created = Math.floor(Date.now() / 1000);
    this.adapter = adapter;
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
    const output = this.adapter(request);

    if (output.type === "content") {
      const contentChunk = this.formatChunk({ content: output.content }, null);
      const finishChunk = this.formatChunk({}, output.finishReason);
      return contentChunk + finishChunk;
    }

    const chunk: ChatCompletionChunk = {
      id: this.requestId,
      object: "chat.completion.chunk",
      created: this.created,
      model: this.model,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: output.toolCalls?.map((tc) => ({
              id: tc.id,
              type: tc.type,
              function: tc.function,
            })),
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
      choices: [{ index: 0, delta: {}, finish_reason: output.finishReason }],
    };
    return deltaChunk + `data: ${JSON.stringify(finishChunk)}\n\n`;
  }

  formatFireForget(request: ExtensionUIRequest): string {
    const output = this.adapter(request);

    if (output.type === "content") {
      return this.formatChunk({ content: output.content }, null);
    }

    const chunk: ChatCompletionChunk = {
      id: this.requestId,
      object: "chat.completion.chunk",
      created: this.created,
      model: this.model,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: output.toolCalls?.map((tc) => ({
              id: tc.id,
              type: tc.type,
              function: tc.function,
            })),
          },
          finish_reason: null,
        },
      ],
    };
    return `data: ${JSON.stringify(chunk)}\n\n`;
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
