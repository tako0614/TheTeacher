-- Material library + ingest tables managed by Prisma
CREATE TABLE IF NOT EXISTS "MaterialLibraryEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "assetPath" TEXT,
    "libraryPath" TEXT,
    "type" TEXT NOT NULL,
    "bytes" INTEGER,
    "learningId" TEXT,
    "materialId" TEXT,
    "originalSource" JSONB,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "MaterialLibraryAsset" (
    "entryId" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BLOB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MaterialLibraryAsset_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "MaterialLibraryEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "MaterialIngestJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "learningId" TEXT,
    "source" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "requestedAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "preferredOcrEngine" TEXT,
    "preferredTranscriptionEngine" TEXT,
    "notes" TEXT,
    "outputMaterialId" TEXT,
    "libraryPath" TEXT
);

CREATE INDEX IF NOT EXISTS "MaterialLibraryEntry_learningId_idx" ON "MaterialLibraryEntry"("learningId");
CREATE INDEX IF NOT EXISTS "MaterialLibraryEntry_materialId_idx" ON "MaterialLibraryEntry"("materialId");
CREATE INDEX IF NOT EXISTS "MaterialLibraryEntry_userId_idx" ON "MaterialLibraryEntry"("userId");
CREATE INDEX IF NOT EXISTS "MaterialLibraryEntry_updatedAt_idx" ON "MaterialLibraryEntry"("updatedAt");

CREATE INDEX IF NOT EXISTS "MaterialLibraryAsset_userId_idx" ON "MaterialLibraryAsset"("userId");

CREATE INDEX IF NOT EXISTS "MaterialIngestJob_learningId_idx" ON "MaterialIngestJob"("learningId");
CREATE INDEX IF NOT EXISTS "MaterialIngestJob_updatedAt_idx" ON "MaterialIngestJob"("updatedAt");
CREATE INDEX IF NOT EXISTS "MaterialIngestJob_userId_idx" ON "MaterialIngestJob"("userId");
