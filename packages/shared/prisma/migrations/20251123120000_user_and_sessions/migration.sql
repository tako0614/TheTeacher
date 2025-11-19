-- Add user and session primitives for multi-device sync
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT UNIQUE,
    "displayName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME
);

CREATE TABLE IF NOT EXISTS "UserSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL UNIQUE,
    "deviceName" TEXT,
    "lastSeenAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "User_createdAt_idx" ON "User"("createdAt");
CREATE INDEX IF NOT EXISTS "User_updatedAt_idx" ON "User"("updatedAt");
CREATE INDEX IF NOT EXISTS "UserSession_userId_idx" ON "UserSession"("userId");
CREATE INDEX IF NOT EXISTS "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

-- Seed a legacy user so existing rows can be backfilled
INSERT OR IGNORE INTO "User" (id, displayName, createdAt, updatedAt)
VALUES ('00000000-0000-4000-8000-000000000000', 'Legacy User', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Add ownership columns to existing tables (defaulting to the legacy user)
ALTER TABLE "Learning" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000000';
CREATE INDEX IF NOT EXISTS "Learning_userId_idx" ON "Learning"("userId");

ALTER TABLE "Material" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000000';
CREATE INDEX IF NOT EXISTS "Material_userId_idx" ON "Material"("userId");

ALTER TABLE "GeneratedContent" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000000';
CREATE INDEX IF NOT EXISTS "GeneratedContent_userId_idx" ON "GeneratedContent"("userId");

ALTER TABLE "PracticeSession" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000000';
CREATE INDEX IF NOT EXISTS "PracticeSession_userId_idx" ON "PracticeSession"("userId");

ALTER TABLE "Preset" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000000';
CREATE INDEX IF NOT EXISTS "Preset_userId_idx" ON "Preset"("userId");

ALTER TABLE "SemanticNode" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '00000000-0000-4000-8000-000000000000';
CREATE INDEX IF NOT EXISTS "SemanticNode_userId_idx" ON "SemanticNode"("userId");
