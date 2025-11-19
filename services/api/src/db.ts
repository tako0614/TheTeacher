import {
  type GeneratedContentType,
  type IngestJob,
  type MaterialLibraryEntry,
  type MaterialType,
  type SemanticNode,
} from "@theteacher/shared";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface LearningRow {
  id: string;
  userId: string;
  title: string;
  subject?: string | null;
  tags?: string | null | unknown;
  progress?: number | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface MaterialRow {
  id: string;
  userId: string;
  learningId: string;
  type: MaterialType;
  sourcePath?: string | null;
  rawContent?: string | null;
  metadata?: string | null | unknown;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface GeneratedContentRow {
  id: string;
  userId: string;
  learningId: string;
  materialId?: string | null;
  type: GeneratedContentType;
  content: string | unknown;
  promptPreset?: string | null;
  createdAt: string | Date;
}

export interface PracticeSessionRow {
  id: string;
  userId: string;
  learningId: string;
  generatedContentId?: string | null;
  questionRef?: string | null | unknown;
  answerText: string;
  isCorrect?: number | null;
  feedback?: string | null | unknown;
  score?: number | null;
  createdAt: string | Date;
}

export interface PresetRow {
  id: string;
  userId: string;
  subject: string;
  title: string;
  systemPrompt: string;
  userInstructionTemplate: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export type LearningWithStatsRow = LearningRow & {
  materialsCount: number;
  generatedCount: number;
  sessionCount: number;
  lastStudiedAt?: string | null;
};

export interface IngestJobRow {
  id: string;
  learningId?: string | null;
  source: string;
  status: string;
  steps: string;
  requestedAt: string;
  updatedAt: string;
  preferredOcrEngine?: string | null;
  preferredTranscriptionEngine?: string | null;
  notes?: string | null;
  outputMaterialId?: string | null;
  libraryPath?: string | null;
}

export interface LibraryEntryRow {
  id: string;
  userId?: string | null;
  displayName: string;
  storedPath: string;
  assetPath?: string | null;
  libraryPath?: string | null;
  type: MaterialType;
  bytes?: number | null;
  learningId?: string | null;
  materialId?: string | null;
  originalSource?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SemanticNodeRow {
  id: string;
  userId: string;
  refType: SemanticNode["refType"];
  refId: string;
  embedding?: string | null | unknown;
  metadata?: string | null | unknown;
}

export interface UserRow {
  id: string;
  email?: string | null;
  displayName?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  lastSeenAt?: string | Date | null;
}

export interface UserSessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  deviceName?: string | null;
  lastSeenAt?: string | Date | null;
  expiresAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export const parseJson = <T = JsonValue>(value?: string | null): T | undefined => {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
};

export const mapIngestJob = (row: IngestJobRow): IngestJob => ({
  id: row.id,
  learningId: row.learningId ?? undefined,
  status: row.status as IngestJob["status"],
  source: parseJson(row.source)!,
  steps: parseJson(row.steps) ?? [],
  preferredOcrEngine: (row.preferredOcrEngine as IngestJob["preferredOcrEngine"]) ?? undefined,
  preferredTranscriptionEngine: (row.preferredTranscriptionEngine as IngestJob["preferredTranscriptionEngine"]) ?? undefined,
  requestedAt: row.requestedAt,
  updatedAt: row.updatedAt,
  notes: row.notes ?? undefined,
  outputMaterialId: row.outputMaterialId ?? undefined,
  libraryPath: row.libraryPath ?? undefined,
});

export const mapLibraryEntry = (row: LibraryEntryRow): MaterialLibraryEntry => ({
  id: row.id,
  userId: row.userId ?? undefined,
  displayName: row.displayName,
  storedPath: row.storedPath,
  assetPath: row.assetPath ?? undefined,
  libraryPath: row.libraryPath ?? undefined,
  type: row.type,
  bytes: typeof row.bytes === "number" ? row.bytes : undefined,
  learningId: row.learningId ?? undefined,
  materialId: row.materialId ?? undefined,
  originalSource: parseJson(row.originalSource),
  notes: row.notes ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const toJson = (value?: unknown) => (value === undefined ? null : JSON.stringify(value));

export const mapUser = (row: UserRow) => ({
  id: row.id,
  email: row.email ?? undefined,
  displayName: row.displayName ?? undefined,
  createdAt: typeof row.createdAt === "string" ? row.createdAt : row.createdAt.toISOString(),
  updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : row.updatedAt.toISOString(),
  lastSeenAt:
    row.lastSeenAt === null || row.lastSeenAt === undefined
      ? undefined
      : typeof row.lastSeenAt === "string"
        ? row.lastSeenAt
        : row.lastSeenAt.toISOString(),
});

export const mapUserSession = (row: UserSessionRow) => ({
  id: row.id,
  userId: row.userId,
  deviceName: row.deviceName ?? undefined,
  lastSeenAt:
    row.lastSeenAt === null || row.lastSeenAt === undefined
      ? undefined
      : typeof row.lastSeenAt === "string"
        ? row.lastSeenAt
        : row.lastSeenAt.toISOString(),
  expiresAt:
    row.expiresAt === null || row.expiresAt === undefined
      ? undefined
      : typeof row.expiresAt === "string"
        ? row.expiresAt
        : row.expiresAt.toISOString(),
  createdAt: typeof row.createdAt === "string" ? row.createdAt : row.createdAt.toISOString(),
  updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : row.updatedAt.toISOString(),
});
