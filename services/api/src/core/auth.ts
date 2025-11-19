import type { Context } from "hono";
import type { User, UserSession } from "@theteacher/shared";
import type { D1Database } from "@cloudflare/workers-types";

import { mapUser, mapUserSession, type UserRow, type UserSessionRow } from "../db";
import { ToolCallError } from "./errors";
import {
  ensureUserTables,
  getPrismaClient,
  nowIso,
  toHexString,
} from "./prisma";
import type { AppEnv } from "./types";

export const DEFAULT_USER_ID = "00000000-0000-4000-8000-000000000000";
export const DEFAULT_USER_DISPLAY_NAME = "Demo User";
export const SESSION_TTL_DAYS = 90;

export interface AuthContext {
  user: User;
  session?: UserSession;
  token?: string;
}

export const hashToken = async (token: string) => {
  const data = new TextEncoder().encode(token);
  if (typeof crypto?.subtle !== "undefined") {
    const digest = await crypto.subtle.digest("SHA-256", data);
    return toHexString(digest);
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(data).digest("hex");
};

export const generateSessionToken = () =>
  `tt_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;

export const extractBearerToken = (req: Request) => {
  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const headerToken = req.headers.get("x-session-token") ?? req.headers.get("x-api-token");
  return headerToken?.trim() || null;
};

export const fetchUserById = async (db: D1Database, id: string) => {
  const prisma = getPrismaClient(db);
  const row = await prisma.user.findUnique({ where: { id } });
  return row ? mapUser(row as unknown as UserRow) : null;
};

export const fetchUserByEmail = async (db: D1Database, email: string) => {
  const prisma = getPrismaClient(db);
  const row = await prisma.user.findUnique({ where: { email } });
  return row ? mapUser(row as unknown as UserRow) : null;
};

export const ensureDefaultUser = async (db: D1Database) => {
  await ensureUserTables(db);
  const prisma = getPrismaClient(db);
  const user = await prisma.user.upsert({
    where: { id: DEFAULT_USER_ID },
    update: {},
    create: { id: DEFAULT_USER_ID, displayName: DEFAULT_USER_DISPLAY_NAME },
  });
  return mapUser(user as unknown as UserRow);
};

export const createUser = async (db: D1Database, data: { email?: string; displayName?: string }) => {
  await ensureUserTables(db);
  const prisma = getPrismaClient(db);
  const created = await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      email: data.email,
      displayName: data.displayName,
    },
  });
  return mapUser(created as unknown as UserRow);
};

export const updateUserProfile = async (
  db: D1Database,
  userId: string,
  data: { email?: string; displayName?: string },
): Promise<User> => {
  await ensureUserTables(db);
  const current = await fetchUserById(db, userId);
  if (!current) {
    throw new ToolCallError("user_not_found", "User not found", 404);
  }
  if (data.email) {
    const existing = await fetchUserByEmail(db, data.email);
    if (existing && existing.id !== userId) {
      throw new ToolCallError("email_conflict", "Email is already in use", 409);
    }
  }
  const prisma = getPrismaClient(db);
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      email: data.email ?? current.email ?? null,
      displayName: data.displayName ?? current.displayName ?? null,
      updatedAt: nowIso(),
    },
  });
  return mapUser(updated as unknown as UserRow);
};

export const createSession = async (
  db: D1Database,
  userId: string,
  deviceName?: string,
): Promise<{ session: UserSession; token: string }> => {
  const token = generateSessionToken();
  const tokenHash = await hashToken(token);
  const expires = new Date();
  expires.setDate(expires.getDate() + SESSION_TTL_DAYS);
  const prisma = getPrismaClient(db);
  const sessionRow = await prisma.userSession.create({
    data: {
      id: crypto.randomUUID(),
      userId,
      tokenHash,
      deviceName,
      expiresAt: expires.toISOString(),
    },
  });
  return { session: mapUserSession(sessionRow as unknown as UserSessionRow), token };
};

export const resolveAuthContext = async (
  db: D1Database,
  req: Request,
  allowAnonymous = true,
): Promise<AuthContext> => {
  const token = extractBearerToken(req);
  await ensureUserTables(db);
  const prisma = getPrismaClient(db);

  if (!token) {
    if (!allowAnonymous) {
      throw new ToolCallError("unauthorized", "Session token is required", 401);
    }
    const user = await ensureDefaultUser(db);
    return { user };
  }

  const tokenHash = await hashToken(token);
  const sessionRow = await prisma.userSession.findUnique({ where: { tokenHash } });
  if (!sessionRow) {
    throw new ToolCallError("unauthorized", "Invalid session token", 401);
  }
  if (sessionRow.expiresAt && new Date(sessionRow.expiresAt as unknown as string).getTime() < Date.now()) {
    throw new ToolCallError("session_expired", "Session has expired", 401);
  }

  const userRow = await prisma.user.findUnique({ where: { id: sessionRow.userId } });
  if (!userRow) {
    throw new ToolCallError("unauthorized", "User not found", 401);
  }
  const now = nowIso();
  await prisma.userSession.update({
    where: { id: sessionRow.id },
    data: { lastSeenAt: now, updatedAt: now },
  });
  await prisma.user.update({
    where: { id: sessionRow.userId },
    data: { lastSeenAt: now, updatedAt: now },
  });
  return {
    user: mapUser(userRow as unknown as UserRow),
    session: mapUserSession(sessionRow as unknown as UserSessionRow),
    token,
  };
};

export const publicPaths = new Set<string>(["/health", "/api/auth/anonymous"]);

export const fallbackUserContext = (): AuthContext => ({
  user: {
    id: DEFAULT_USER_ID,
    displayName: DEFAULT_USER_DISPLAY_NAME,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  },
});

export const requireAuth = (c: Context<AppEnv>) => {
  const auth = c.get("auth") as AuthContext | undefined;
  if (!auth) {
    throw new ToolCallError("unauthorized", "Session is required", 401);
  }
  return auth;
};
