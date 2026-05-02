import { Hono } from "hono";

export const modelsRoutes = new Hono();

modelsRoutes.get("/v1/models", (c) => {
  const modelName = process.env.PI_MODEL_NAME ?? "pi-agent";
  return c.json({
    object: "list",
    data: [
      {
        id: modelName,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "pi-server",
      },
    ],
  });
});
