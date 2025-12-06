import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { fallbackUserContext, publicPaths, resolveAuthContext, type AuthContext } from "../core/auth";
import { ToolCallError } from "../core/errors";
import { ensureCoreTables } from "../core/prisma";
import type { AppEnv } from "../core/types";

export const app = new Hono<AppEnv>();

declare module "hono" {
  interface ContextVariableMap {
    auth?: AuthContext;
  }
}

app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (publicPaths.has(path)) return next();

  const db = c.env?.DB;
  if (!db) {
    c.set("auth", fallbackUserContext());
    return next();
  }

  try {
    const auth = await resolveAuthContext(db, c.req.raw);
    await ensureCoreTables(db);
    c.set("auth", auth);
    return next();
  } catch (error) {
    const status =
      error instanceof ToolCallError && error.status ? (error.status as ContentfulStatusCode) : 401;
    const message = error instanceof Error ? error.message : "unauthorized";
    return c.json({ error: "unauthorized", message }, status);
  }
});
