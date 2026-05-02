import type { Config } from "../config.js";
import { RpcBridge } from "./rpc-bridge.js";

interface ManagedProcess {
  bridge: RpcBridge;
  sessionId: string;
  sessionFile?: string;
  lastActivity: number;
}

export class ProcessManager {
  private processes = new Map<string, ManagedProcess>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private config: Config) {}

  start(): void {
    this.cleanupTimer = setInterval(() => this.evictExpired(), this.config.cleanupIntervalMs);
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const [id, managed] of this.processes) {
      managed.bridge.destroy();
      this.processes.delete(id);
    }
  }

  get(sessionId: string): RpcBridge | undefined {
    const managed = this.processes.get(sessionId);
    if (managed) {
      managed.lastActivity = Date.now();
      return managed.bridge;
    }
    return undefined;
  }

  has(sessionId: string): boolean {
    return this.processes.has(sessionId);
  }

  create(sessionId: string, sessionFile?: string): RpcBridge {
    if (this.processes.size >= this.config.maxSessions) {
      this.evictOldest();
    }

    if (this.processes.has(sessionId)) {
      this.destroy(sessionId);
    }

    const bridge = new RpcBridge(
      this.config.agentBinary,
      this.config.agentCwd,
      this.config.agentArgs,
      sessionFile,
    );

    bridge.on("exit", () => {
      this.processes.delete(sessionId);
    });

    bridge.spawn();

    this.processes.set(sessionId, {
      bridge,
      sessionId,
      sessionFile,
      lastActivity: Date.now(),
    });

    return bridge;
  }

  destroy(sessionId: string): void {
    const managed = this.processes.get(sessionId);
    if (managed) {
      managed.bridge.destroy();
      this.processes.delete(sessionId);
    }
  }

  getSessionFile(sessionId: string): string | undefined {
    return this.processes.get(sessionId)?.sessionFile;
  }

  setSessionFile(sessionId: string, sessionFile: string): void {
    const managed = this.processes.get(sessionId);
    if (managed) {
      managed.sessionFile = sessionFile;
    }
  }

  listSessions(): Array<{ sessionId: string; lastActivity: number; busy: boolean; alive: boolean }> {
    return Array.from(this.processes.entries()).map(([id, managed]) => ({
      sessionId: id,
      lastActivity: managed.lastActivity,
      busy: managed.bridge.busy,
      alive: managed.bridge.alive,
    }));
  }

  get size(): number {
    return this.processes.size;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [id, managed] of this.processes) {
      if (managed.bridge.busy) continue;
      if (now - managed.lastActivity > this.config.sessionTtlMs) {
        console.log(`[pi-server] Evicting idle session: ${id}`);
        managed.bridge.destroy();
        this.processes.delete(id);
      }
    }
  }

  private evictOldest(): void {
    let oldest: { id: string; time: number } | null = null;
    for (const [id, managed] of this.processes) {
      if (managed.bridge.busy) continue;
      if (!oldest || managed.lastActivity < oldest.time) {
        oldest = { id, time: managed.lastActivity };
      }
    }
    if (oldest) {
      console.log(`[pi-server] Evicting oldest session to make room: ${oldest.id}`);
      this.destroy(oldest.id);
    }
  }
}
