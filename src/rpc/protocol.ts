// RPC commands sent to pi-coding-agent via stdin

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export type RpcCommand =
  | { type: "prompt"; message: string; images?: ImageContent[]; streamingBehavior?: "steer" | "followUp" }
  | { type: "steer"; message: string; images?: ImageContent[] }
  | { type: "follow_up"; message: string; images?: ImageContent[] }
  | { type: "abort" }
  | { type: "new_session"; parentSession?: string }
  | { type: "switch_session"; sessionPath: string }
  | { type: "get_state" }
  | { type: "get_messages" }
  | { type: "get_available_models" }
  | { type: "compact"; customInstructions?: string };

export interface RpcCommandEnvelope {
  id?: string;
  type: string;
  [key: string]: unknown;
}

// RPC responses received from pi-coding-agent via stdout

export interface RpcResponse {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

// Agent events streamed from pi-coding-agent via stdout

export interface TextContent {
  type: "text";
  text: string;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type AssistantContentBlock = TextContent | ThinkingContent | ToolCall;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: AssistantContentBlock[];
  model: string;
  usage: Usage;
  stopReason: string;
  timestamp: number;
}

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  isError: boolean;
  timestamp: number;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;

// AssistantMessageEvent variants we care about

export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: "stop" | "length" | "toolUse"; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };

// Agent events

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean };

// Extension UI requests forwarded to clients as tool_calls
export interface ExtensionUIRequest {
  type: "extension_ui_request";
  id: string;
  method: string;
  params: unknown;
  [key: string]: unknown;
}

export const FIRE_AND_FORGET_METHODS = new Set(["notify", "setStatus", "setWidget", "setTitle", "set_editor_text"]);

export const CUSTOM_WIDGET_KEYS = new Set(["push_file", "structured_content"]);

export interface ExtensionUIResponse {
  type: "extension_ui_response";
  id: string;
  cancelled?: boolean;
  result?: unknown;
}

export type RpcLine = RpcResponse | AgentEvent | ExtensionUIRequest;
