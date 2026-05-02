import { randomUUID } from "node:crypto";
import type { AgentEvent, AssistantMessage, ExtensionUIRequest } from "../rpc/protocol.js";
import type { ChatCompletionResponse, OpenAIUsage, OpenAIToolCall } from "./types.js";
import { extensionUIToToolCall } from "./formatter.js";

export class ResponseBuilder {
  private textContent = "";
  private model: string;
  private finalMessage: AssistantMessage | null = null;
  private _uiRequest: ExtensionUIRequest | null = null;

  constructor(model: string) {
    this.model = model;
  }

  processEvent(event: AgentEvent): void {
    if (event.type === "message_update") {
      const ame = event.assistantMessageEvent;
      if (ame.type === "text_delta") {
        this.textContent += ame.delta;
      }
    }

    if (event.type === "agent_end") {
      const lastAssistant = [...event.messages]
        .reverse()
        .find((m): m is AssistantMessage => m.role === "assistant");
      if (lastAssistant) {
        this.finalMessage = lastAssistant;
      }
    }
  }

  setUIRequest(request: ExtensionUIRequest): void {
    this._uiRequest = request;
  }

  get hasUIRequest(): boolean {
    return this._uiRequest !== null;
  }

  build(): ChatCompletionResponse {
    if (this._uiRequest) {
      return this.buildUIRequestResponse();
    }

    const usage = this.extractUsage();
    const finishReason = this.finalMessage?.stopReason === "length" ? "length" as const : "stop" as const;

    return {
      id: `chatcmpl-${randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: this.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: this.textContent || null,
          },
          finish_reason: finishReason,
        },
      ],
      usage,
    };
  }

  private buildUIRequestResponse(): ChatCompletionResponse {
    const toolCall = extensionUIToToolCall(this._uiRequest!);
    return {
      id: `chatcmpl-${randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: this.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: this.textContent || null,
            tool_calls: [toolCall],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: this.extractUsage(),
    };
  }

  private extractUsage(): OpenAIUsage {
    if (this.finalMessage?.usage) {
      const u = this.finalMessage.usage;
      return {
        prompt_tokens: u.inputTokens,
        completion_tokens: u.outputTokens,
        total_tokens: u.inputTokens + u.outputTokens,
      };
    }
    return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  }
}
