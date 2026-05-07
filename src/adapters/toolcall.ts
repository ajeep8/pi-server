import type { ExtensionUIRequest } from "../rpc/protocol.js";
import type { AdapterOutput } from "./types.js";

export function toolcallAdapter(request: ExtensionUIRequest): AdapterOutput {
  const { name, args } = resolveMethodAndArgs(request);

  return {
    type: "tool_calls",
    toolCalls: [
      {
        id: request.id,
        type: "function",
        function: { name, arguments: args },
      },
    ],
    finishReason: "tool_calls",
  };
}

function resolveMethodAndArgs(request: ExtensionUIRequest): { name: string; args: string } {
  if (request.method === "setWidget" && typeof request.widgetKey === "string") {
    const widgetLines = request.widgetLines as string[] | undefined;
    const payload = widgetLines?.[0] ?? "{}";
    return { name: `extension_ui_${request.widgetKey}`, args: payload };
  }

  return { name: `extension_ui_${request.method}`, args: JSON.stringify(request.params ?? {}) };
}
