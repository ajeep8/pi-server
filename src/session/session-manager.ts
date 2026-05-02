import { randomUUID } from "node:crypto";
import type { ProcessManager } from "../rpc/process-manager.js";
import type { RpcBridge } from "../rpc/rpc-bridge.js";
import type { OpenAIMessage, OpenAIContentPart } from "../openai/types.js";
import type { ImageContent } from "../rpc/protocol.js";

export interface SessionContext {
  bridge: RpcBridge;
  sessionId: string;
  isNew: boolean;
}

export class SessionManager {
  constructor(private processManager: ProcessManager) {}

  getOrCreate(sessionId: string | null): SessionContext {
    const id = sessionId ?? `ephemeral_${randomUUID()}`;
    const existing = this.processManager.get(id);

    if (existing?.alive) {
      return { bridge: existing, sessionId: id, isNew: false };
    }

    const bridge = this.processManager.create(id);
    return { bridge, sessionId: id, isNew: true };
  }

  destroy(sessionId: string): void {
    this.processManager.destroy(sessionId);
  }
}

export function extractLatestUserMessage(messages: OpenAIMessage[]): {
  text: string;
  systemPrompt: string | null;
  images: ImageContent[];
} {
  let systemPrompt: string | null = null;
  let text = "";
  const images: ImageContent[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemPrompt = typeof msg.content === "string" ? msg.content : contentPartsToText(msg.content);
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        text = contentPartsToText(msg.content);
        for (const part of msg.content) {
          if (part.type === "image_url" && part.image_url?.url) {
            const parsed = parseDataUrl(part.image_url.url);
            if (parsed) {
              images.push(parsed);
            }
          }
        }
      }
      break;
    }
  }

  return { text, systemPrompt, images };
}

export function buildFullPrompt(messages: OpenAIMessage[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    const content = typeof msg.content === "string" ? msg.content : contentPartsToText(msg.content);
    if (!content) continue;
    switch (msg.role) {
      case "system":
        parts.push(`[System]\n${content}`);
        break;
      case "user":
        parts.push(`[User]\n${content}`);
        break;
      case "assistant":
        parts.push(`[Assistant]\n${content}`);
        break;
    }
  }
  return parts.join("\n\n");
}

function contentPartsToText(parts: OpenAIContentPart[] | null): string {
  if (!parts) return "";
  return parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("\n");
}

function parseDataUrl(url: string): ImageContent | null {
  const match = url.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!match) return null;
  return { type: "image", mimeType: match[1], data: match[2] };
}
