import {
  type GeneratedContentType,
  type IngestJob,
  type MaterialLibraryEntry,
  type MaterialType,
} from "@theteacher/shared";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface LearningRow {
  id: string;
  title: string;
  subject?: string | null;
  tags?: string | null;
  progress?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialRow {
  id: string;
  learningId: string;
  type: MaterialType;
  sourcePath?: string | null;
  rawContent?: string | null;
  metadata?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedContentRow {
  id: string;
  learningId: string;
  materialId?: string | null;
  type: GeneratedContentType;
  content: string;
  promptPreset?: string | null;
  createdAt: string;
}

export interface PracticeSessionRow {
  id: string;
  learningId: string;
  generatedContentId?: string | null;
  questionRef?: string | null;
  answerText: string;
  isCorrect?: number | null;
  feedback?: string | null;
  score?: number | null;
  createdAt: string;
}

export interface PresetRow {
  id: string;
  subject: string;
  title: string;
  systemPrompt: string;
  userInstructionTemplate: string;
  createdAt: string;
  updatedAt: string;
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
  displayName: string;
  storedPath: string;
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
  displayName: row.displayName,
  storedPath: row.storedPath,
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
