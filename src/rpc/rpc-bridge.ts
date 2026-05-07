import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { RpcCommandEnvelope, RpcResponse, AgentEvent, ExtensionUIRequest, ExtensionUIResponse, RpcLine } from "./protocol.js";
import { FIRE_AND_FORGET_METHODS, CUSTOM_WIDGET_KEYS } from "./protocol.js";

export type BridgeState = "idle" | "busy" | "waiting_ui";

export type RpcBridgeEvent = {
  event: (event: AgentEvent) => void;
  response: (response: RpcResponse) => void;
  extension_ui_request: (request: ExtensionUIRequest) => void;
  error: (error: Error) => void;
  exit: (code: number | null) => void;
};

export class RpcBridge extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer = "";
  private _state: BridgeState = "idle";
  private _alive = false;
  private commandCounter = 0;
  private _pendingUIRequest: ExtensionUIRequest | null = null;

  constructor(
    private binary: string,
    private cwd: string,
    private extraArgs: string[] = [],
    private sessionPath?: string,
  ) {
    super();
  }

  get state(): BridgeState {
    return this._state;
  }

  get busy(): boolean {
    return this._state === "busy";
  }

  get waitingUI(): boolean {
    return this._state === "waiting_ui";
  }

  get alive(): boolean {
    return this._alive;
  }

  get pendingUIRequest(): ExtensionUIRequest | null {
    return this._pendingUIRequest;
  }

  spawn(): void {
    const args = ["--mode", "rpc", ...this.extraArgs];
    if (this.sessionPath) {
      args.push("--session", this.sessionPath);
    }

    this.process = spawn("tsx", [this.binary, ...args], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this._alive = true;

    this.process.stdout!.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processLines();
    });

    this.process.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        console.error(`[pi-agent stderr] ${text}`);
      }
    });

    this.process.on("exit", (code) => {
      this._alive = false;
      this._state = "idle";
      this._pendingUIRequest = null;
      this.emit("exit", code);
    });

    this.process.on("error", (err) => {
      this._alive = false;
      this._state = "idle";
      this._pendingUIRequest = null;
      this.emit("error", err);
    });
  }

  private processLines(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let parsed: RpcLine;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }

      if (parsed.type === "response") {
        this.emit("response", parsed as RpcResponse);
      } else if (parsed.type === "extension_ui_request") {
        const uiRequest = parsed as ExtensionUIRequest;
        const isCustomWidget = uiRequest.method === "setWidget" && CUSTOM_WIDGET_KEYS.has(uiRequest.widgetKey as string);

        if (isCustomWidget) {
          console.log(`[pi-server] Custom widget: ${uiRequest.widgetKey}`);
          this.emit("extension_ui_request", uiRequest);
        } else if (FIRE_AND_FORGET_METHODS.has(uiRequest.method)) {
          this.emit("extension_ui_fire_forget", uiRequest);
        } else {
          this._pendingUIRequest = uiRequest;
          this._state = "waiting_ui";
          this.emit("extension_ui_request", uiRequest);
        }
      } else {
        const event = parsed as AgentEvent;
        if (event.type === "agent_end") {
          this._state = "idle";
          this._pendingUIRequest = null;
        }
        this.emit("event", event);
      }
    }
  }

  respondToUIRequest(id: string, result?: unknown, cancelled = false): void {
    if (this._pendingUIRequest?.id !== id) {
      throw new Error(`No pending UI request with id: ${id}`);
    }
    const response: ExtensionUIResponse = { type: "extension_ui_response", id };
    if (cancelled) {
      response.cancelled = true;
    } else {
      response.result = result;
    }
    this.send(response as unknown as RpcCommandEnvelope);
    this._pendingUIRequest = null;
    this._state = "busy";
  }

  send(command: RpcCommandEnvelope): string {
    if (!this.process?.stdin?.writable) {
      throw new Error("RPC process is not running");
    }
    const id = command.id ?? `cmd_${++this.commandCounter}`;
    const envelope = { ...command, id };
    this.process.stdin.write(JSON.stringify(envelope) + "\n");
    return id;
  }

  sendPrompt(message: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): string {
    this._state = "busy";
    const cmd: RpcCommandEnvelope = { type: "prompt", message };
    if (images?.length) {
      (cmd as Record<string, unknown>).images = images;
    }
    return this.send(cmd);
  }

  sendFollowUp(message: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): string {
    this._state = "busy";
    const cmd: RpcCommandEnvelope = { type: "follow_up", message };
    if (images?.length) {
      (cmd as Record<string, unknown>).images = images;
    }
    return this.send(cmd);
  }

  sendAbort(): string {
    return this.send({ type: "abort" });
  }

  sendGetMessages(): string {
    return this.send({ type: "get_messages" });
  }

  sendGetState(): string {
    return this.send({ type: "get_state" });
  }

  sendSwitchSession(sessionPath: string): string {
    return this.send({ type: "switch_session", sessionPath });
  }

  async sendCommandAndWaitResponse(command: RpcCommandEnvelope, timeoutMs = 30000): Promise<RpcResponse> {
    const id = this.send(command);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener("response", onResponse);
        reject(new Error(`RPC command ${command.type} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const onResponse = (response: RpcResponse) => {
        if (response.id === id) {
          clearTimeout(timer);
          this.removeListener("response", onResponse);
          resolve(response);
        }
      };
      this.on("response", onResponse);
    });
  }

  destroy(): void {
    if (this.process) {
      this._alive = false;
      this._state = "idle";
      this._pendingUIRequest = null;
      this.process.kill("SIGTERM");
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill("SIGKILL");
        }
      }, 5000);
      this.process = null;
    }
    this.removeAllListeners();
  }
}
