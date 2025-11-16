-- CreateTable
CREATE TABLE "Learning" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "subject" TEXT,
    "tags" JSONB,
    "progress" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "learningId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sourcePath" TEXT,
    "rawContent" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Material_learningId_fkey" FOREIGN KEY ("learningId") REFERENCES "Learning" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GeneratedContent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "learningId" TEXT NOT NULL,
    "materialId" TEXT,
    "type" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "promptPreset" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GeneratedContent_learningId_fkey" FOREIGN KEY ("learningId") REFERENCES "Learning" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GeneratedContent_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticeSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "learningId" TEXT NOT NULL,
    "generatedContentId" TEXT,
    "questionRef" JSONB,
    "answerText" TEXT NOT NULL,
    "isCorrect" BOOLEAN,
    "feedback" JSONB,
    "score" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PracticeSession_learningId_fkey" FOREIGN KEY ("learningId") REFERENCES "Learning" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticeSession_generatedContentId_fkey" FOREIGN KEY ("generatedContentId") REFERENCES "GeneratedContent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Preset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subject" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "userInstructionTemplate" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SemanticNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "embedding" BLOB,
    "metadata" JSONB
);

-- CreateIndex
CREATE INDEX "Learning_subject_idx" ON "Learning"("subject");

-- CreateIndex
CREATE INDEX "Learning_createdAt_idx" ON "Learning"("createdAt");

-- CreateIndex
CREATE INDEX "Learning_updatedAt_idx" ON "Learning"("updatedAt");

-- CreateIndex
CREATE INDEX "Material_learningId_idx" ON "Material"("learningId");

-- CreateIndex
CREATE INDEX "Material_type_idx" ON "Material"("type");

-- CreateIndex
CREATE INDEX "GeneratedContent_learningId_idx" ON "GeneratedContent"("learningId");

-- CreateIndex
CREATE INDEX "GeneratedContent_type_idx" ON "GeneratedContent"("type");

-- CreateIndex
CREATE INDEX "GeneratedContent_materialId_idx" ON "GeneratedContent"("materialId");

-- CreateIndex
CREATE INDEX "PracticeSession_learningId_idx" ON "PracticeSession"("learningId");

-- CreateIndex
CREATE INDEX "PracticeSession_generatedContentId_idx" ON "PracticeSession"("generatedContentId");

-- CreateIndex
CREATE INDEX "PracticeSession_createdAt_idx" ON "PracticeSession"("createdAt");

-- CreateIndex
CREATE INDEX "Preset_subject_idx" ON "Preset"("subject");

-- CreateIndex
CREATE INDEX "Preset_title_idx" ON "Preset"("title");

-- CreateIndex
CREATE INDEX "SemanticNode_refType_idx" ON "SemanticNode"("refType");

-- CreateIndex
CREATE INDEX "SemanticNode_refId_idx" ON "SemanticNode"("refId");
