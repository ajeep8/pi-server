import type { Adapter } from "./types.js";
import { toolcallAdapter } from "./toolcall.js";
import { structuredJsonAdapter } from "./structured-json.js";

export type { Adapter, AdapterOutput } from "./types.js";

const adapters: Record<string, Adapter> = {
  toolcall: toolcallAdapter,
  "structured-json": structuredJsonAdapter,
};

export function loadAdapter(name?: string): Adapter {
  const key = name ?? "toolcall";
  const adapter = adapters[key];
  if (!adapter) {
    throw new Error(`Unknown adapter: "${key}". Available: ${Object.keys(adapters).join(", ")}`);
  }
  return adapter;
}
