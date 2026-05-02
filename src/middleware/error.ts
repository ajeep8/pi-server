import type { Context, Next } from "hono";

export async function errorMiddleware(c: Context, next: Next) {
  try {
    await next();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error(`[pi-server] Error: ${message}`);
    return c.json(
      {
        error: {
          message,
          type: "server_error",
          code: "internal_error",
        },
      },
      500,
    );
  }
}
