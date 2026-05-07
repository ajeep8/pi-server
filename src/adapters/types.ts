import type { ExtensionUIRequest } from "../rpc/protocol.js";
import type { OpenAIToolCall } from "../openai/types.js";

export interface AdapterOutput {
  type: "content" | "tool_calls";
  content?: string;
  toolCalls?: OpenAIToolCall[];
  finishReason: "stop" | "tool_calls";
}

export type Adapter = (request: ExtensionUIRequest) => AdapterOutput;
