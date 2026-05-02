import type { Context, Next } from "hono";
import { timingSafeEqual } from "node:crypto";

export function authMiddleware(authToken: string | null) {
  return async (c: Context, next: Next) => {
    if (!authToken) return next();

    const path = new URL(c.req.url).pathname;
    if (path === "/health" || path === "/v1/models") {
      return next();
    }

    const header = c.req.header("authorization");
    if (!header) {
      return c.json({ error: { message: "Missing Authorization header", type: "auth_error", code: "missing_auth" } }, 401);
    }

    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return c.json({ error: { message: "Malformed Authorization header", type: "auth_error", code: "invalid_auth" } }, 401);
    }

    const provided = Buffer.from(match[1]);
    const expected = Buffer.from(authToken);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return c.json({ error: { message: "Invalid API key", type: "auth_error", code: "invalid_api_key" } }, 401);
    }

    return next();
  };
}
