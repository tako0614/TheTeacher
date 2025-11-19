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
  userId?: string | null;
  learningId?: string | null;
  source: string | unknown;
  status: string;
  steps: string | unknown;
  requestedAt: string | Date;
  updatedAt: string | Date;
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
  originalSource?: string | null | unknown;
  notes?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
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

const toMaybeJson = <T = JsonValue>(value?: string | JsonValue | null): T | undefined => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return parseJson<T>(value);
  return value as T;
};

const toIsoString = (value: string | Date) =>
  typeof value === "string" ? value : value.toISOString();

export const mapIngestJob = (row: IngestJobRow): IngestJob => {
  const source = toMaybeJson<IngestJob["source"]>(row.source as string | JsonValue | null);
  const steps = toMaybeJson<IngestJob["steps"]>(row.steps as string | JsonValue | null);
  return {
    id: row.id,
    userId: row.userId ?? undefined,
    learningId: row.learningId ?? undefined,
    status: row.status as IngestJob["status"],
    source: source ?? { kind: "text", text: "" },
    steps: Array.isArray(steps) ? steps : [],
    preferredOcrEngine: (row.preferredOcrEngine as IngestJob["preferredOcrEngine"]) ?? undefined,
    preferredTranscriptionEngine: (row.preferredTranscriptionEngine as IngestJob["preferredTranscriptionEngine"]) ?? undefined,
    requestedAt: toIsoString(row.requestedAt as string | Date),
    updatedAt: toIsoString(row.updatedAt as string | Date),
    notes: row.notes ?? undefined,
    outputMaterialId: row.outputMaterialId ?? undefined,
    libraryPath: row.libraryPath ?? undefined,
  };
};

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
  originalSource: toMaybeJson(row.originalSource as string | JsonValue | null),
  notes: row.notes ?? undefined,
  createdAt: typeof row.createdAt === "string" ? row.createdAt : row.createdAt.toISOString(),
  updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : row.updatedAt.toISOString(),
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
