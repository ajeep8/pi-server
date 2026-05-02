export interface Config {
  port: number;
  agentBinary: string;
  agentCwd: string;
  agentArgs: string[];
  authToken: string | null;
  sessionTtlMs: number;
  maxSessions: number;
  cleanupIntervalMs: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env.PORT ?? "8000", 10),
    agentBinary: required("PI_AGENT_BINARY"),
    agentCwd: process.env.PI_AGENT_CWD ?? process.cwd(),
    agentArgs: process.env.PI_AGENT_ARGS?.split(" ").filter(Boolean) ?? [],
    authToken: process.env.AUTH_TOKEN ?? null,
    sessionTtlMs: parseInt(process.env.SESSION_TTL_MS ?? "1800000", 10),
    maxSessions: parseInt(process.env.MAX_SESSIONS ?? "100", 10),
    cleanupIntervalMs: parseInt(process.env.CLEANUP_INTERVAL_MS ?? "60000", 10),
  };
}
