import { randomUUID } from "node:crypto";
import type { AgentEvent, AssistantMessage, ExtensionUIRequest } from "../rpc/protocol.js";
import type { ChatCompletionResponse, OpenAIUsage } from "./types.js";
import type { Adapter } from "../adapters/types.js";

export class ResponseBuilder {
  private textContent = "";
  private model: string;
  private finalMessage: AssistantMessage | null = null;
  private _uiRequest: ExtensionUIRequest | null = null;
  private adapter: Adapter;

  constructor(model: string, adapter: Adapter) {
    this.model = model;
    this.adapter = adapter;
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

  processFireForget(request: ExtensionUIRequest): void {
    const output = this.adapter(request);
    if (output.type === "content" && output.content) {
      this.textContent += output.content;
    }
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
    const output = this.adapter(this._uiRequest!);

    if (output.type === "content") {
      const content = this.textContent
        ? this.textContent + output.content
        : output.content ?? null;

      return {
        id: `chatcmpl-${randomUUID()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: this.model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: output.finishReason,
          },
        ],
        usage: this.extractUsage(),
      };
    }

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
            tool_calls: output.toolCalls,
          },
          finish_reason: output.finishReason,
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
