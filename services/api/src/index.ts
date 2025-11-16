import { schemas } from "@theteacher/shared";
import { Hono } from "hono";
import { z } from "zod";

const proxyRequestSchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
  model: z.string().default("gpt-4o-mini"),
});

export const app = new Hono();

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

app.post("/ai/proxy", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = proxyRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        error: "invalid_request",
        issues: parsed.error.format(),
      },
      400,
    );
  }

  // This is a stub; wire to actual AI provider or Workers AI later.
  return c.json({
    message: "AI proxy is not yet connected to a model provider.",
    request: parsed.data,
    exampleSchema: {
      learning: schemas.learning.keyof().options,
    },
  });
});

export default app;
