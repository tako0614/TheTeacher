import { Hono } from "hono";
import { cors } from "hono/cors";
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

// CORS middleware
app.use("*", cors({
  origin: (origin) => {
    // Allow localhost in development
    if (origin?.includes("localhost") || origin?.includes("127.0.0.1")) {
      return origin;
    }
    // Allow production origins (configure as needed)
    return origin ?? "*";
  },
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  maxAge: 86400,
}));

// Security headers middleware
app.use("*", async (c, next) => {
  await next();
  // Add security headers
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "1; mode=block");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  // HSTS for HTTPS connections
  if (c.req.url.startsWith("https://")) {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
});

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
