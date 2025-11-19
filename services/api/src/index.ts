import type { D1Database } from "@cloudflare/workers-types";
import {
  generateFromMaterialRequestSchema,
  materialIngestResultSchema,
  schemas,
  type GenerateFromMaterialRequest,
  type GeneratedContent,
  type GenerationJob,
  type IngestJob,
  type IngestSource,
  type Learning,
  type Material,
  type MaterialIngestRequest,
  type MaterialLibraryEntry,
  type PracticeSession,
  type Preset,
  type SemanticNode,
  refTypeSchema,
  ingestRequestSchema,
} from "@theteacher/shared";
import { Hono } from "hono";
import { z } from "zod";

import {
  mapIngestJob,
  mapLibraryEntry,
  parseJson,
  toJson,
  type GeneratedContentRow,
  type IngestJobRow,
  type LearningWithStatsRow,
  type LearningRow,
  type LibraryEntryRow,
  type MaterialRow,
  type PracticeSessionRow,
  type PresetRow,
} from "./db";

const proxyRequestSchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
  model: z.string().default("gpt-4o-mini"),
  topK: z.number().int().min(1).max(10).default(3).optional(),
});

const embedRequestSchema = z.object({
  texts: z.array(z.string().min(1)).min(1),
});

const semanticSearchRequestSchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().min(1).max(10).default(5),
  refType: refTypeSchema.optional(),
  subject: z.string().min(1).optional(),
});

const learningListQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  subject: z.string().trim().min(1).optional(),
  tag: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const presetListQuerySchema = z.object({
  subject: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const ingestJobListQuerySchema = z.object({
  learningId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const libraryEntryListQuerySchema = z.object({
  learningId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const toolCallSchema = z.object({
  tool: z.enum([
    "search_learnings",
    "create_learning_from_chat",
    "generate_questions",
    "save_content",
  ]),
  params: z.record(z.string(), z.unknown()).optional(),
});

const upsertLearningSchema = schemas.learning
  .pick({
    id: true,
    title: true,
    subject: true,
    tags: true,
    progress: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial({ id: true, progress: true, subject: true, tags: true, createdAt: true, updatedAt: true })
  .extend({
    title: z.string().min(1),
  });

const updateLearningSchema = upsertLearningSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: "at least one field is required" },
);

const upsertMaterialSchema = schemas.material
  .pick({
    id: true,
    learningId: true,
    type: true,
    sourcePath: true,
    rawContent: true,
    metadata: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial({ id: true, sourcePath: true, rawContent: true, metadata: true, createdAt: true, updatedAt: true })
  .extend({
    learningId: z.string().uuid(),
    type: schemas.material.shape.type,
  });

const updateMaterialSchema = upsertMaterialSchema
  .omit({ learningId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field is required",
  });

const ingestMaterialRequestSchema = ingestRequestSchema.extend({
  learningId: z.string().uuid(),
});

const upsertGeneratedSchema = schemas.generatedContent
  .pick({
    id: true,
    learningId: true,
    materialId: true,
    type: true,
    content: true,
    promptPreset: true,
    createdAt: true,
  })
  .partial({ id: true, materialId: true, promptPreset: true, createdAt: true })
  .extend({
    learningId: z.string().uuid(),
    type: schemas.generatedContent.shape.type,
    content: z.record(z.string(), z.unknown()),
  });

const upsertSessionSchema = schemas.practiceSession
  .pick({
    id: true,
    learningId: true,
    generatedContentId: true,
    questionRef: true,
    answerText: true,
    isCorrect: true,
    feedback: true,
    score: true,
    createdAt: true,
  })
  .partial({
    id: true,
    generatedContentId: true,
    isCorrect: true,
    feedback: true,
    score: true,
    questionRef: true,
    createdAt: true,
  })
  .extend({
    learningId: z.string().uuid(),
    answerText: z.string().min(1),
  });

const upsertPresetSchema = schemas.preset
  .pick({
    id: true,
    subject: true,
    title: true,
    systemPrompt: true,
    userInstructionTemplate: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial({ id: true, createdAt: true, updatedAt: true })
  .extend({
    subject: z.string().min(1),
    title: z.string().min(1),
    systemPrompt: z.string().min(1),
    userInstructionTemplate: z.string().min(1),
  });

const updatePresetSchema = upsertPresetSchema
  .omit({ id: true })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "at least one field is required",
  });

type AppBindings = {
  DB: D1Database;
};

type AppEnv = {
  Bindings: AppBindings;
};

export const app = new Hono<AppEnv>();

const nowIso = () => new Date().toISOString();
let materialTablesReady: Promise<void> | null = null;

const ensureMaterialTables = (db?: D1Database) => {
  if (!db) return Promise.resolve();
  if (!materialTablesReady) {
    materialTablesReady = (async () => {
      await db
        .prepare(
          `CREATE TABLE IF NOT EXISTS MaterialLibraryEntry (
            id TEXT PRIMARY KEY,
            displayName TEXT NOT NULL,
            storedPath TEXT NOT NULL,
            libraryPath TEXT,
            type TEXT NOT NULL,
            bytes INTEGER,
            learningId TEXT,
            materialId TEXT,
            originalSource TEXT,
            notes TEXT,
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL
          )`,
        )
        .run();
      await db
        .prepare("CREATE INDEX IF NOT EXISTS idx_material_library_learning ON MaterialLibraryEntry(learningId)")
        .run();
      await db
        .prepare(
          `CREATE TABLE IF NOT EXISTS MaterialIngestJob (
            id TEXT PRIMARY KEY,
            learningId TEXT,
            source TEXT NOT NULL,
            status TEXT NOT NULL,
            steps TEXT NOT NULL,
            requestedAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL,
            preferredOcrEngine TEXT,
            preferredTranscriptionEngine TEXT,
            notes TEXT,
            outputMaterialId TEXT,
            libraryPath TEXT
          )`,
        )
        .run();
      await db
        .prepare("CREATE INDEX IF NOT EXISTS idx_ingest_jobs_learning ON MaterialIngestJob(learningId)")
        .run();
      await db
        .prepare("CREATE INDEX IF NOT EXISTS idx_ingest_jobs_updated ON MaterialIngestJob(updatedAt DESC)")
        .run();
    })();
  }
  return materialTablesReady;
};

class ToolCallError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const mapLearning = (row: LearningWithStatsRow): Learning & {
  materialsCount: number;
  generatedCount: number;
  sessionCount: number;
  lastStudiedAt?: string;
} => ({
  id: row.id,
  title: row.title,
  subject: row.subject ?? undefined,
  tags: parseJson<string[]>(row.tags),
  progress: row.progress ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  materialsCount: row.materialsCount ?? 0,
  generatedCount: row.generatedCount ?? 0,
  sessionCount: row.sessionCount ?? 0,
  lastStudiedAt: row.lastStudiedAt ?? undefined,
});

const mapMaterial = (row: MaterialRow): Material => ({
  id: row.id,
  learningId: row.learningId,
  type: row.type,
  sourcePath: row.sourcePath ?? undefined,
  rawContent: row.rawContent ?? undefined,
  metadata: parseJson<Record<string, unknown>>(row.metadata),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const saveLibraryEntry = async (
  db: D1Database,
  entry: MaterialLibraryEntry,
): Promise<MaterialLibraryEntry> => {
  await ensureMaterialTables(db);
  await db
    .prepare(
      `INSERT OR REPLACE INTO MaterialLibraryEntry
        (id, displayName, storedPath, libraryPath, type, bytes, learningId, materialId, originalSource, notes, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      entry.id,
      entry.displayName,
      entry.storedPath,
      entry.libraryPath ?? null,
      entry.type,
      entry.bytes ?? null,
      entry.learningId ?? null,
      entry.materialId ?? null,
      toJson(entry.originalSource),
      entry.notes ?? null,
      entry.createdAt,
      entry.updatedAt,
    )
    .run();
  const row = await db
    .prepare("SELECT * FROM MaterialLibraryEntry WHERE id = ? LIMIT 1")
    .bind(entry.id)
    .first<LibraryEntryRow>();
  return row ? mapLibraryEntry(row) : entry;
};

const saveIngestJob = async (db: D1Database, job: IngestJob): Promise<IngestJob> => {
  await ensureMaterialTables(db);
  await db
    .prepare(
      `INSERT OR REPLACE INTO MaterialIngestJob
        (id, learningId, source, status, steps, requestedAt, updatedAt,
          preferredOcrEngine, preferredTranscriptionEngine, notes, outputMaterialId, libraryPath)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      job.id,
      job.learningId ?? null,
      toJson(job.source),
      job.status,
      toJson(job.steps),
      job.requestedAt,
      job.updatedAt,
      job.preferredOcrEngine ?? null,
      job.preferredTranscriptionEngine ?? null,
      job.notes ?? null,
      job.outputMaterialId ?? null,
      job.libraryPath ?? null,
    )
    .run();
  const row = await db
    .prepare("SELECT * FROM MaterialIngestJob WHERE id = ? LIMIT 1")
    .bind(job.id)
    .first<IngestJobRow>();
  return row ? mapIngestJob(row) : job;
};

const listIngestJobs = async (db?: D1Database, learningId?: string, limit = 50) => {
  if (!db) return [];
  await ensureMaterialTables(db);
  let sql = "SELECT * FROM MaterialIngestJob";
  const binds: unknown[] = [];
  if (learningId) {
    sql += " WHERE learningId = ?";
    binds.push(learningId);
  }
  sql += " ORDER BY updatedAt DESC LIMIT ?";
  binds.push(limit);
  const rows = await db.prepare(sql).bind(...binds).all<IngestJobRow>();
  return rows.results?.map(mapIngestJob) ?? [];
};

const listLibraryEntries = async (db?: D1Database, learningId?: string, limit = 50) => {
  if (!db) return [];
  await ensureMaterialTables(db);
  let sql = "SELECT * FROM MaterialLibraryEntry";
  const binds: unknown[] = [];
  if (learningId) {
    sql += " WHERE learningId = ?";
    binds.push(learningId);
  }
  sql += " ORDER BY updatedAt DESC LIMIT ?";
  binds.push(limit);
  const rows = await db.prepare(sql).bind(...binds).all<LibraryEntryRow>();
  return rows.results?.map(mapLibraryEntry) ?? [];
};

const mapGeneratedContent = (row: GeneratedContentRow): GeneratedContent => ({
  id: row.id,
  learningId: row.learningId,
  materialId: row.materialId ?? undefined,
  type: row.type,
  content: parseJson<Record<string, unknown>>(row.content) ?? {},
  promptPreset: row.promptPreset ?? undefined,
  createdAt: row.createdAt,
});

const mapPracticeSession = (row: PracticeSessionRow): PracticeSession => ({
  id: row.id,
  learningId: row.learningId,
  generatedContentId: row.generatedContentId ?? undefined,
  questionRef: parseJson<Record<string, unknown>>(row.questionRef),
  answerText: row.answerText,
  isCorrect: row.isCorrect === null ? undefined : Boolean(row.isCorrect),
  feedback: parseJson<Record<string, unknown>>(row.feedback),
  score: typeof row.score === "number" ? row.score : undefined,
  createdAt: row.createdAt,
});

const mapPreset = (row: PresetRow): Preset => ({
  id: row.id,
  subject: row.subject,
  title: row.title,
  systemPrompt: row.systemPrompt,
  userInstructionTemplate: row.userInstructionTemplate,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const insertLearning = async (
  db: D1Database,
  data: Pick<Learning, "title"> &
    Partial<Pick<Learning, "subject" | "tags" | "progress" | "id" | "createdAt" | "updatedAt">>,
): Promise<Learning> => {
  const id = data.id ?? crypto.randomUUID();
  const createdAt = data.createdAt ?? nowIso();
  const updatedAt = data.updatedAt ?? createdAt;

  await db
    .prepare(
      `INSERT OR REPLACE INTO Learning (id, title, subject, tags, progress, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      data.title,
      data.subject ?? null,
      data.tags ? toJson(data.tags) : null,
      data.progress ?? null,
      createdAt,
      updatedAt,
    )
    .run();

  const learning = await fetchLearning(db, id);
  return (
    learning ?? {
      id,
      title: data.title,
      subject: data.subject,
      tags: data.tags,
      progress: data.progress,
      createdAt,
      updatedAt,
      materialsCount: 0,
      generatedCount: 0,
      sessionCount: 0,
    }
  );
};

const ingestStepTemplates: Record<
  IngestSource["kind"] | "fallback",
  IngestJob["steps"]
> = {
  pdf: [
    { id: "download", label: "ローカル保存", kind: "download", status: "pending" },
    { id: "ocr", label: "ページOCR", kind: "ocr", status: "pending" },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  image: [
    { id: "download", label: "ローカル保存", kind: "download", status: "pending" },
    { id: "ocr", label: "OCR", kind: "ocr", status: "pending" },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  audio: [
    { id: "download", label: "ローカル保存", kind: "download", status: "pending" },
    { id: "transcription", label: "文字起こし", kind: "transcription", status: "pending" },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  video: [
    { id: "download", label: "ローカル保存", kind: "download", status: "pending" },
    { id: "transcription", label: "音声抽出/文字起こし", kind: "transcription", status: "pending" },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  url: [
    { id: "download", label: "スクレイピング", kind: "download", status: "pending" },
    { id: "meta", label: "本文抽出", kind: "metadata", status: "pending" },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  text: [
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  fallback: [{ id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" }],
};

const fetchMaterial = async (db: D1Database, id: string) => {
  const row = await db
    .prepare("SELECT * FROM Material WHERE id = ? LIMIT 1")
    .bind(id)
    .first<MaterialRow>();
  return row ? mapMaterial(row) : null;
};

const fetchLatestMaterialForLearning = async (db: D1Database, learningId: string) => {
  const row = await db
    .prepare(
      "SELECT * FROM Material WHERE learningId = ? ORDER BY updatedAt DESC LIMIT 1",
    )
    .bind(learningId)
    .first<MaterialRow>();
  return row ? mapMaterial(row) : null;
};

const saveGeneratedContent = async (
  db: D1Database,
  data: Omit<GeneratedContent, "id" | "createdAt"> &
    Partial<Pick<GeneratedContent, "id" | "createdAt">>,
): Promise<GeneratedContent> => {
  const id = data.id ?? crypto.randomUUID();
  const createdAt = data.createdAt ?? nowIso();

  await db
    .prepare(
      `INSERT OR REPLACE INTO GeneratedContent (id, learningId, materialId, type, content, promptPreset, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      data.learningId,
      data.materialId ?? null,
      data.type,
      toJson(data.content),
      data.promptPreset ?? null,
      createdAt,
    )
    .run();

  const row = await db
    .prepare("SELECT * FROM GeneratedContent WHERE id = ? LIMIT 1")
    .bind(id)
    .first<GeneratedContentRow>();
  return row ? mapGeneratedContent(row) : { ...data, id, createdAt };
};

const summarizeText = (text: string, limit = 280) =>
  text.replace(/\s+/g, " ").trim().slice(0, limit);

const stripHtml = (value: string) =>
  value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const fetchRemoteText = async (url: string): Promise<string> => {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = await res.json().catch(() => null);
    return typeof json === "string" ? json : JSON.stringify(json ?? {});
  }
  const raw = await res.text();
  if (contentType.includes("html")) return stripHtml(raw).slice(0, 16_000);
  return raw.slice(0, 16_000);
};

const extractMaterialFromSource = async (
  source: IngestSource,
  preferOffline = false,
  payload?: MaterialIngestRequest["payload"],
) => {
  const payloadText = payload?.text?.trim();
  if (payloadText) {
    const preview = summarizeText(payloadText);
    return {
      rawContent: payloadText,
      extracted: {
        preview,
        tokens: payloadText.split(/\s+/).filter(Boolean).length,
        format:
          source.kind === "image"
            ? ("ocr" as const)
            : source.kind === "audio" || source.kind === "video"
              ? ("transcript" as const)
              : ("plain" as const),
      },
      metadata: {
        sourceLabel: source.kind,
        payloadFileName: payload.fileName,
        payloadBytes: payload.bytes,
        payloadMimeType: payload.mimeType,
        payloadDataUrlPreview: payload.dataUrl?.slice(0, 120),
      },
    };
  }

  if (source.kind === "text") {
    const rawContent = source.text.trim();
    const preview = summarizeText(rawContent);
    return {
      rawContent,
      extracted: {
        preview,
        tokens: rawContent.split(/\s+/).filter(Boolean).length,
        format: "plain" as const,
      },
      metadata: { sourceLabel: "text" },
    };
  }

  if (source.kind === "url") {
    const previewLabel = `URLから抽出: ${source.url}`;
    if (preferOffline) {
      return {
        rawContent: previewLabel,
        extracted: {
          preview: summarizeText(previewLabel),
          format: "scraped" as const,
        },
        metadata: { sourceLabel: "url_offline" },
      };
    }

    try {
      const fetched = await fetchRemoteText(source.url);
      const cleaned = fetched.trim();
      const preview = summarizeText(cleaned || previewLabel);
      return {
        rawContent: cleaned || previewLabel,
        extracted: {
          preview,
          tokens: cleaned.split(/\s+/).filter(Boolean).length,
          format: "scraped" as const,
        },
        metadata: { sourceLabel: "url" },
      };
    } catch (error) {
      const fallback = `${previewLabel} (取得に失敗しました: ${error instanceof Error ? error.message : "unknown error"})`;
      return {
        rawContent: fallback,
        extracted: {
          preview: summarizeText(fallback),
          format: "scraped" as const,
        },
        metadata: { sourceLabel: "url_error" },
      };
    }
  }

  const isAudio = source.kind === "audio" || source.kind === "video";
  const isOcr = source.kind === "image" || source.kind === "pdf";
  const base =
    source.path.startsWith("http") && !preferOffline
      ? `リモートファイル ${source.path} を取得しました。`
      : `[${source.kind.toUpperCase()}] ${source.path}`;
  const tail = isAudio
    ? " 音声を文字起こししたテキストを保存しています。"
    : isOcr
      ? " OCR経由で抽出したテキストです。"
      : " 教材のテキストを取り込みました。";
  const rawContent = `${base}${tail}`.trim();
  const preview = summarizeText(rawContent);
  return {
    rawContent,
    extracted: {
      preview,
      tokens: rawContent.split(/\s+/).filter(Boolean).length,
      format: isAudio ? ("transcript" as const) : isOcr ? ("ocr" as const) : ("plain" as const),
    },
    metadata: { sourceLabel: source.kind, preferOffline },
  };
};

const buildIngestJob = (
  request: MaterialIngestRequest,
  status: IngestJob["status"] = "completed",
  outputMaterialId?: string,
  libraryPath?: string,
): IngestJob => {
  const now = nowIso();
  const steps = (ingestStepTemplates[request.source.kind] ?? ingestStepTemplates.fallback).map(
    (step, index) => ({
      ...step,
      status: status === "completed" ? "succeeded" : index === 0 ? "running" : step.status,
      startedAt: status === "queued" ? undefined : now,
      finishedAt: status === "completed" ? now : undefined,
    }),
  );

  return {
    id: crypto.randomUUID(),
    learningId: request.learningId,
    source: request.source,
    status,
    requestedAt: now,
    updatedAt: now,
    preferredOcrEngine: request.ocrEngine,
    preferredTranscriptionEngine: request.transcriptionEngine,
    steps,
    notes: request.preferOffline ? "prefer_offline" : undefined,
    outputMaterialId,
    libraryPath: libraryPath ?? "TheTeacher/materials",
  };
};

const buildLibraryEntryRecord = (
  material: Material,
  request: MaterialIngestRequest,
  options?: { entryId?: string; notes?: string },
): MaterialLibraryEntry => {
  const storedPath =
    request.source.kind === "url"
      ? request.source.url
      : request.source.kind === "text"
        ? `${material.id}.txt`
        : request.source.path ?? material.sourcePath ?? material.id;
  const displayName =
    request.payload?.fileName ??
    material.sourcePath ??
    `${material.type.toUpperCase()}_${material.id.slice(0, 8)}`;
  const inferredLibraryPath =
    request.source.kind === "text"
      ? `${material.learningId}/${material.id}.txt`
      : request.source.kind === "url"
        ? request.source.url
        : request.source.path ?? request.payload?.fileName ?? storedPath;

  return {
    id: options?.entryId ?? crypto.randomUUID(),
    displayName,
    storedPath,
    libraryPath: inferredLibraryPath,
    type: material.type,
    bytes: request.payload?.bytes,
    learningId: material.learningId,
    materialId: material.id,
    originalSource: request.source,
    notes: options?.notes,
    createdAt: material.createdAt,
    updatedAt: material.updatedAt,
  };
};

const splitIdeas = (text: string, limit = 3) => {
  const normalized = text.replace(/\s+/g, " ").trim();
  const sentences = normalized
    .split(/(?<=[。\.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (sentences.length >= limit) return sentences.slice(0, limit);
  const newlineChunks = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const words = normalized
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const joined = newlineChunks.length ? newlineChunks.join(" ") : words.join(" ");
  return (sentences.length ? sentences : [joined]).slice(0, limit);
};

type PresetContext = {
  title?: string;
  systemPrompt?: string;
  userTemplate?: string;
};

const buildGenerationJob = (
  types: GenerateFromMaterialRequest["types"],
  preset?: PresetContext,
): GenerationJob => ({
  createdAt: nowIso(),
  completedAt: nowIso(),
  presetTitle: preset?.title,
  types,
  notes: preset?.title ? `preset="${preset.title}"` : undefined,
});

const buildContentForType = (
  type: GeneratedContent["type"],
  ideas: string[],
  baseText: string,
  preset?: PresetContext,
) => {
  const sourceTitle = preset?.title ?? "教材";
  const presetHint = preset?.userTemplate
    ? preset.userTemplate.replace(/\{\{content\}\}/gi, summarizeText(baseText, 160))
    : null;

  if (type === "qa") {
    const pairs = ideas.map((idea, index) => ({
      question: `Q${index + 1}: ${summarizeText(idea, 72)} は何を意味しますか？`,
      answer: idea,
      rationale: presetHint ?? `教材から抽出: ${summarizeText(idea, 120)}`,
    }));
    return {
      title: `${sourceTitle} 一問一答`,
      preview: pairs[0]?.question ?? "教材の要点からQ&Aを生成しました。",
      pairs,
    };
  }

  if (type === "practice") {
    const items = ideas.map((idea, index) => ({
      prompt: `設問${index + 1}: ${summarizeText(idea, 90)}`,
      expectedAnswer: idea,
      hint: presetHint ?? `キーワード: ${summarizeText(idea, 42)}`,
      explanation: summarizeText(`${idea} に基づき、主要手順を文章で説明してください。`, 140),
    }));
    return {
      title: `${sourceTitle} 練習問題`,
      preview: items[0]?.prompt ?? "教材から短答式の問題を生成しました。",
      items,
    };
  }

  if (type === "podcast_script") {
    const segments = ideas.map((idea, index) => ({
      speaker: index % 2 === 0 ? "Host" : "Guest",
      text: summarizeText(`${preset?.systemPrompt ? `${preset.systemPrompt} / ` : ""}${idea}`, 140),
    }));
    return {
      title: `${sourceTitle} ポッドキャスト用スクリプト`,
      preview: segments[0]?.text ?? "対話形式のスクリプトを生成しました。",
      segments,
    };
  }

  if (type === "summary") {
    const bullets = ideas.map((idea) => summarizeText(idea, 120));
    return {
      title: `${sourceTitle} 要約`,
      preview: bullets.join(" / ").slice(0, 140),
      bullets,
      summary: summarizeText(baseText, 320),
    };
  }

  return {
    title: `${sourceTitle} 生成コンテンツ`,
    preview: summarizeText(baseText, 80),
  };
};

const craftGeneratedContents = (
  request: GenerateFromMaterialRequest,
  material: Material | null,
  preset?: PresetContext,
): Array<Omit<GeneratedContent, "id" | "createdAt">> => {
  const baseText =
    material?.rawContent?.trim() ||
    material?.sourcePath ||
    "教材本文が未登録です。";
  const ideas = splitIdeas(baseText, 5);
  const promptPreset =
    preset?.title ??
    request.presetTitle ??
    request.presetUserTemplate ??
    request.presetId;

  return request.types.map((type) => ({
    learningId: request.learningId,
    materialId: material?.id,
    type,
    promptPreset: promptPreset ?? undefined,
    content: buildContentForType(type, ideas, baseText, preset),
  }));
};

const fetchLearning = async (db: D1Database, id: string) => {
  const result = await db
    .prepare(
      `SELECT l.*, 
        (SELECT COUNT(*) FROM Material m WHERE m.learningId = l.id) AS materialsCount,
        (SELECT COUNT(*) FROM GeneratedContent g WHERE g.learningId = l.id) AS generatedCount,
        (SELECT COUNT(*) FROM PracticeSession s WHERE s.learningId = l.id) AS sessionCount,
        (SELECT MAX(createdAt) FROM PracticeSession s2 WHERE s2.learningId = l.id) AS lastStudiedAt
      FROM Learning l WHERE l.id = ? LIMIT 1`,
    )
    .bind(id)
    .first<LearningWithStatsRow>();
  return result ? mapLearning(result) : null;
};

const fetchPreset = async (db: D1Database, id: string) => {
  const row = await db
    .prepare("SELECT * FROM Preset WHERE id = ? LIMIT 1")
    .bind(id)
    .first<PresetRow>();
  return row ? mapPreset(row) : null;
};

const resolvePresetContext = async (
  db: D1Database,
  request: GenerateFromMaterialRequest,
): Promise<PresetContext | undefined> => {
  if (request.presetId) {
    const preset = await fetchPreset(db, request.presetId);
    if (preset) {
      return {
        title: preset.title,
        systemPrompt: preset.systemPrompt,
        userTemplate: preset.userInstructionTemplate,
      };
    }
  }

  if (request.presetTitle || request.presetSystemPrompt || request.presetUserTemplate) {
    return {
      title: request.presetTitle,
      systemPrompt: request.presetSystemPrompt,
      userTemplate: request.presetUserTemplate,
    };
  }

  return undefined;
};

const buildLearningListQuery = (
  params: z.infer<typeof learningListQuerySchema>,
): { sql: string; binds: unknown[] } => {
  let sql = `SELECT l.*, 
    (SELECT COUNT(*) FROM Material m WHERE m.learningId = l.id) AS materialsCount,
    (SELECT COUNT(*) FROM GeneratedContent g WHERE g.learningId = l.id) AS generatedCount,
    (SELECT COUNT(*) FROM PracticeSession s WHERE s.learningId = l.id) AS sessionCount,
    (SELECT MAX(createdAt) FROM PracticeSession s2 WHERE s2.learningId = l.id) AS lastStudiedAt
    FROM Learning l WHERE 1=1`;
  const binds: unknown[] = [];

  if (params.subject) {
    sql += " AND l.subject = ?";
    binds.push(params.subject);
  }

  if (params.tag) {
    sql += " AND LOWER(COALESCE(l.tags, '')) LIKE ?";
    binds.push(`%${params.tag.toLowerCase()}%`);
  }

  if (params.q) {
    sql += " AND (LOWER(l.title) LIKE ? OR LOWER(COALESCE(l.tags, '')) LIKE ?)";
    const like = `%${params.q.toLowerCase()}%`;
    binds.push(like, like);
  }

  sql += " ORDER BY l.updatedAt DESC LIMIT ?";
  binds.push(params.limit);

  return { sql, binds };
};

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

app.get("/api/learnings", async (c) => {
  const query = Object.fromEntries(new URL(c.req.url).searchParams);
  const parsed = learningListQuerySchema.safeParse(query);
  if (!parsed.success) {
    return c.json({ error: "invalid_query", issues: parsed.error.format() }, 400);
  }

  const { sql, binds } = buildLearningListQuery(parsed.data);
  const rows = await c.env.DB.prepare(sql).bind(...binds).all<LearningWithStatsRow>();
  const items = rows.results?.map(mapLearning) ?? [];
  return c.json({ items, count: items.length });
});

app.get("/api/learnings/:id", async (c) => {
  const id = c.req.param("id");
  const learning = await fetchLearning(c.env.DB, id);
  if (!learning) return c.json({ error: "not_found" }, 404);
  return c.json(learning);
});

app.post("/api/learnings", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = upsertLearningSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const learning = await insertLearning(c.env.DB, parsed.data);
  return c.json(learning, 201);
});

app.put("/api/learnings/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updateLearningSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const exists = await fetchLearning(c.env.DB, id);
  if (!exists) return c.json({ error: "not_found" }, 404);

  const data = parsed.data;
  const updatedAt = data.updatedAt ?? nowIso();

  await c.env.DB.prepare(
    `UPDATE Learning SET
      title = COALESCE(?, title),
      subject = COALESCE(?, subject),
      tags = COALESCE(?, tags),
      progress = COALESCE(?, progress),
      updatedAt = ?
    WHERE id = ?`,
  )
    .bind(
      data.title ?? null,
      data.subject ?? null,
      data.tags ? toJson(data.tags) : null,
      data.progress ?? null,
      updatedAt,
      id,
    )
    .run();

  const learning = await fetchLearning(c.env.DB, id);
  return c.json(learning);
});

app.delete("/api/learnings/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM Learning WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

app.get("/api/learnings/:id/materials", async (c) => {
  const id = c.req.param("id");
  const rows = await c.env.DB
    .prepare("SELECT * FROM Material WHERE learningId = ? ORDER BY createdAt DESC")
    .bind(id)
    .all<MaterialRow>();
  const items = rows.results?.map(mapMaterial) ?? [];
  return c.json({ items });
});

app.post("/api/materials/ingest", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = ingestMaterialRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const request = parsed.data;
  const learning = await fetchLearning(c.env.DB, request.learningId);
  if (!learning) return c.json({ error: "learning_not_found" }, 404);

  const { rawContent, extracted, metadata: ingestMetadata } = await extractMaterialFromSource(
    request.source,
    request.preferOffline ?? false,
    request.payload,
  );
  const id = crypto.randomUUID();
  const libraryEntryId = crypto.randomUUID();
  const createdAt = nowIso();
  const updatedAt = createdAt;
  const type = request.source.kind as Material["type"];
  const sourcePath =
    request.source.kind === "url"
      ? request.source.url
      : request.source.kind === "text"
        ? summarizeText(request.source.text, 120)
        : request.source.path;

  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO Material (id, learningId, type, sourcePath, rawContent, metadata, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      request.learningId,
      type,
      sourcePath ?? null,
      rawContent ?? null,
      toJson({
        ingestSource: request.source,
        preferOffline: request.preferOffline ?? false,
        extracted,
        origin: ingestMetadata?.sourceLabel,
        libraryEntryId,
      }),
      createdAt,
      updatedAt,
    )
    .run();

  const material =
    (await fetchMaterial(c.env.DB, id)) ??
    ({
      id,
      learningId: request.learningId,
      type,
      sourcePath: sourcePath ?? undefined,
      rawContent: rawContent ?? undefined,
      metadata: undefined,
      createdAt,
      updatedAt,
    } as Material);

  const libraryEntry = await saveLibraryEntry(
    c.env.DB,
    buildLibraryEntryRecord(material, request, {
      entryId: libraryEntryId,
      notes: ingestMetadata?.sourceLabel,
    }),
  );
  const jobDraft = buildIngestJob(
    request,
    "completed",
    material.id,
    libraryEntry.libraryPath ?? libraryEntry.storedPath,
  );
  const job = await saveIngestJob(c.env.DB, { ...jobDraft, outputMaterialId: material.id });

  return c.json(materialIngestResultSchema.parse({ material, job, extracted }), 201);
});

app.post("/api/materials", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = upsertMaterialSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const data = parsed.data;
  const id = data.id ?? crypto.randomUUID();
  const createdAt = data.createdAt ?? nowIso();
  const updatedAt = data.updatedAt ?? createdAt;

  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO Material (id, learningId, type, sourcePath, rawContent, metadata, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      data.learningId,
      data.type,
      data.sourcePath ?? null,
      data.rawContent ?? null,
      toJson(data.metadata),
      createdAt,
      updatedAt,
    )
    .run();

  const row = await c.env.DB
    .prepare("SELECT * FROM Material WHERE id = ? LIMIT 1")
    .bind(id)
    .first<MaterialRow>();
  return c.json(row ? mapMaterial(row) : null, 201);
});

app.get("/api/ingest-jobs", async (c) => {
  const query = Object.fromEntries(new URL(c.req.url).searchParams);
  const parsed = ingestJobListQuerySchema.safeParse(query);
  if (!parsed.success) {
    return c.json({ error: "invalid_query", issues: parsed.error.format() }, 400);
  }
  const items = await listIngestJobs(c.env.DB, parsed.data.learningId, parsed.data.limit);
  return c.json({ items, count: items.length });
});

app.get("/api/materials/library", async (c) => {
  const query = Object.fromEntries(new URL(c.req.url).searchParams);
  const parsed = libraryEntryListQuerySchema.safeParse(query);
  if (!parsed.success) {
    return c.json({ error: "invalid_query", issues: parsed.error.format() }, 400);
  }
  const items = await listLibraryEntries(c.env.DB, parsed.data.learningId, parsed.data.limit);
  return c.json({ items, count: items.length });
});

app.put("/api/materials/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updateMaterialSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const exists = await fetchMaterial(c.env.DB, id);
  if (!exists) return c.json({ error: "not_found" }, 404);

  const data = parsed.data;
  const updatedAt = data.updatedAt ?? nowIso();

  await c.env.DB.prepare(
    `UPDATE Material SET
      type = COALESCE(?, type),
      sourcePath = COALESCE(?, sourcePath),
      rawContent = COALESCE(?, rawContent),
      metadata = COALESCE(?, metadata),
      updatedAt = ?
    WHERE id = ?`,
  )
    .bind(
      data.type ?? null,
      data.sourcePath ?? null,
      data.rawContent ?? null,
      data.metadata ? toJson(data.metadata) : null,
      updatedAt,
      id,
    )
    .run();

  const material = await fetchMaterial(c.env.DB, id);
  return c.json(material);
});

app.get("/api/learnings/:id/contents", async (c) => {
  const id = c.req.param("id");
  const rows = await c.env.DB
    .prepare("SELECT * FROM GeneratedContent WHERE learningId = ? ORDER BY createdAt DESC")
    .bind(id)
    .all<GeneratedContentRow>();
  const items = rows.results?.map(mapGeneratedContent) ?? [];
  return c.json({ items });
});

app.post("/api/contents", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = upsertGeneratedSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const data = parsed.data;
  const saved = await saveGeneratedContent(c.env.DB, data);
  return c.json(saved, 201);
});

app.post("/api/generate/from-material", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = generateFromMaterialRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const request = parsed.data;
  const learning = await fetchLearning(c.env.DB, request.learningId);
  if (!learning) return c.json({ error: "learning_not_found" }, 404);

  const material =
    request.materialId && request.materialId.length > 0
      ? await fetchMaterial(c.env.DB, request.materialId)
      : await fetchLatestMaterialForLearning(c.env.DB, request.learningId);

  if (request.materialId && !material) {
    return c.json({ error: "material_not_found" }, 404);
  }

  const preset = await resolvePresetContext(c.env.DB, request);
  const drafts = craftGeneratedContents(request, material, preset);
  const items: GeneratedContent[] = [];
  for (const draft of drafts) {
    items.push(await saveGeneratedContent(c.env.DB, draft));
  }

  const job = buildGenerationJob(request.types, preset);
  return c.json({ material, job, items });
});

app.get("/api/learnings/:id/sessions", async (c) => {
  const id = c.req.param("id");
  const rows = await c.env.DB
    .prepare("SELECT * FROM PracticeSession WHERE learningId = ? ORDER BY createdAt DESC")
    .bind(id)
    .all<PracticeSessionRow>();
  const items = rows.results?.map(mapPracticeSession) ?? [];
  return c.json({ items });
});

app.post("/api/sessions", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = upsertSessionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const data = parsed.data;
  const id = data.id ?? crypto.randomUUID();
  const createdAt = data.createdAt ?? nowIso();

  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO PracticeSession (id, learningId, generatedContentId, questionRef, answerText, isCorrect, feedback, score, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      data.learningId,
      data.generatedContentId ?? null,
      toJson(data.questionRef),
      data.answerText,
      data.isCorrect === undefined ? null : data.isCorrect ? 1 : 0,
      toJson(data.feedback),
      data.score ?? null,
      createdAt,
    )
    .run();

  const row = await c.env.DB
    .prepare("SELECT * FROM PracticeSession WHERE id = ? LIMIT 1")
    .bind(id)
    .first<PracticeSessionRow>();
  return c.json(row ? mapPracticeSession(row) : null, 201);
});

app.get("/api/presets", async (c) => {
  const query = Object.fromEntries(new URL(c.req.url).searchParams);
  const parsed = presetListQuerySchema.safeParse(query);
  if (!parsed.success) {
    return c.json({ error: "invalid_query", issues: parsed.error.format() }, 400);
  }

  const binds: unknown[] = [];
  let sql = "SELECT * FROM Preset";
  if (parsed.data.subject) {
    sql += " WHERE subject = ?";
    binds.push(parsed.data.subject);
  }
  sql += " ORDER BY updatedAt DESC LIMIT ?";
  binds.push(parsed.data.limit);

  const rows = await c.env.DB.prepare(sql).bind(...binds).all<PresetRow>();
  const items = rows.results?.map(mapPreset) ?? [];
  return c.json({ items, count: items.length });
});

app.get("/api/presets/:id", async (c) => {
  const preset = await fetchPreset(c.env.DB, c.req.param("id"));
  if (!preset) return c.json({ error: "not_found" }, 404);
  return c.json(preset);
});

app.post("/api/presets", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = upsertPresetSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const data = parsed.data;
  const id = data.id ?? crypto.randomUUID();
  const createdAt = data.createdAt ?? nowIso();
  const updatedAt = data.updatedAt ?? createdAt;

  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO Preset (id, subject, title, systemPrompt, userInstructionTemplate, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      data.subject,
      data.title,
      data.systemPrompt,
      data.userInstructionTemplate,
      createdAt,
      updatedAt,
    )
    .run();

  const preset = await fetchPreset(c.env.DB, id);
  return c.json(preset, 201);
});

app.put("/api/presets/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updatePresetSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const exists = await fetchPreset(c.env.DB, id);
  if (!exists) return c.json({ error: "not_found" }, 404);

  const data = parsed.data;
  const updatedAt = data.updatedAt ?? nowIso();
  await c.env.DB.prepare(
    `UPDATE Preset SET
      subject = COALESCE(?, subject),
      title = COALESCE(?, title),
      systemPrompt = COALESCE(?, systemPrompt),
      userInstructionTemplate = COALESCE(?, userInstructionTemplate),
      updatedAt = ?
    WHERE id = ?`,
  )
    .bind(
      data.subject ?? null,
      data.title ?? null,
      data.systemPrompt ?? null,
      data.userInstructionTemplate ?? null,
      updatedAt,
      id,
    )
    .run();

  const preset = await fetchPreset(c.env.DB, id);
  return c.json(preset);
});

app.delete("/api/presets/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM Preset WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

type SemanticNodeWithMeta = SemanticNode & {
  label: string;
  excerpt: string;
  subject?: string;
};

type SemanticMatch = SemanticNodeWithMeta & {
  score: number;
  embedding: number[];
};

const generatedLabelMap: Record<GeneratedContent["type"], string> = {
  qa: "一問一答",
  practice: "練習問題",
  summary: "要約",
  podcast_script: "ポッドキャスト",
  other: "その他",
};

const EMBEDDING_DIMENSION = 12;

const toEmbedding = (text: string): number[] => {
  const vec = Array.from({ length: EMBEDDING_DIMENSION }, () => 0);
  for (let i = 0; i < text.length; i++) {
    const bucket = i % EMBEDDING_DIMENSION;
    vec[bucket] += text.charCodeAt(i) % 31;
  }
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value ** 2, 0)) || 1;
  return vec.map((value) => Number((value / norm).toFixed(4)));
};

const cosineSimilarity = (a: number[], b: number[]): number => {
  const dim = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < dim; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (!Number.isFinite(denom) || denom === 0) return 0;
  return Number((dot / denom).toFixed(4));
};

const flattenContent = (content: unknown): string => {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(flattenContent).join(" ");
  if (typeof content === "object") {
    return Object.values(content as Record<string, unknown>)
      .map((value) => flattenContent(value))
      .filter(Boolean)
      .join(" ");
  }
  return String(content);
};

const fallbackSemanticNodes = (): Array<SemanticNodeWithMeta & { embedding: number[] }> =>
  [
    {
      id: "fallback-learning",
      refType: "learning",
      refId: "fallback-learning",
      embedding: toEmbedding("高校数学 二次関数 基礎練習"),
      metadata: { tags: ["math"] },
      label: "高校数学I: 二次関数",
      excerpt: "二次関数の基本変換と判別式を確認する練習セット",
      subject: "math",
    },
  ].map((node) => ({ ...node, embedding: node.embedding.slice() }));

const fallbackLearnings: Array<
  Learning & { materialsCount: number; generatedCount: number; sessionCount: number }
> = [
  {
    id: "fallback-learning",
    title: "高校数学I_二次関数_第1回",
    subject: "math",
    tags: ["demo", "math"],
    progress: 0.2,
    createdAt: "2024-11-01T00:00:00.000Z",
    updatedAt: "2024-11-03T00:00:00.000Z",
    materialsCount: 2,
    generatedCount: 3,
    sessionCount: 5,
  },
];

const normalizeTagsInput = (value: unknown): string[] | undefined => {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((tag) => String(tag ?? "").trim())
      .filter((tag) => tag.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }
  return undefined;
};

const buildSemanticIndex = async (
  db?: D1Database,
): Promise<Array<SemanticNodeWithMeta & { embedding: number[] }>> => {
  if (!db) return fallbackSemanticNodes();
  const learningRows = await db
    .prepare("SELECT * FROM Learning ORDER BY updatedAt DESC LIMIT 200")
    .all<LearningRow>();
  const learnings =
    learningRows.results?.map((row) => ({
      id: row.id,
      title: row.title,
      subject: row.subject ?? undefined,
      tags: parseJson<string[]>(row.tags) ?? [],
    })) ?? [];

  const learningSubjectMap = new Map(learnings.map((item) => [item.id, item.subject]));

  const materialRows = await db
    .prepare("SELECT * FROM Material ORDER BY updatedAt DESC LIMIT 200")
    .all<MaterialRow>();

  const contentRows = await db
    .prepare("SELECT * FROM GeneratedContent ORDER BY createdAt DESC LIMIT 200")
    .all<GeneratedContentRow>();

  const nodes: Array<SemanticNodeWithMeta & { embedding: number[] }> = [];

  for (const learning of learnings) {
    const basis = `${learning.title} ${learning.subject ?? ""} ${(learning.tags ?? []).join(" ")}`;
    nodes.push({
      id: learning.id,
      refType: "learning",
      refId: learning.id,
      embedding: toEmbedding(basis),
      metadata: { tags: learning.tags },
      label: learning.title,
      excerpt: summarizeText(basis, 120),
      subject: learning.subject,
    });
  }

  for (const row of materialRows.results ?? []) {
    const mapped = mapMaterial(row);
    const learningSubject = learningSubjectMap.get(mapped.learningId);
    const body = mapped.rawContent ?? mapped.sourcePath ?? mapped.type;
    nodes.push({
      id: mapped.id,
      refType: "material",
      refId: mapped.id,
      embedding: toEmbedding(`${mapped.type} ${body}`),
      metadata: mapped.metadata,
      label: `${mapped.type.toUpperCase()}: ${summarizeText(mapped.sourcePath ?? mapped.rawContent ?? "material", 48)}`,
      excerpt: summarizeText(body ?? mapped.type, 160),
      subject: learningSubject,
    });
  }

  for (const row of contentRows.results ?? []) {
    const mapped = mapGeneratedContent(row);
    const body = flattenContent(mapped.content);
    const learningSubject = learningSubjectMap.get(mapped.learningId);
    nodes.push({
      id: mapped.id,
      refType: "generated_content",
      refId: mapped.id,
      embedding: toEmbedding(`${mapped.type} ${body}`),
      metadata: { promptPreset: mapped.promptPreset },
      label: `${generatedLabelMap[mapped.type] ?? mapped.type}: ${summarizeText(body, 48)}`,
      excerpt: summarizeText(body, 160),
      subject: learningSubject,
    });
  }

  if (nodes.length > 0) return nodes;

  return fallbackSemanticNodes();
};

const searchSemantic = async (
  db: D1Database | undefined,
  query: string,
  topK: number,
  filters?: Partial<Pick<SemanticNodeWithMeta, "refType" | "subject">>,
): Promise<SemanticMatch[]> => {
  const index = await buildSemanticIndex(db);
  const queryVector = toEmbedding(query);

  const matches = index
    .filter((node) => {
      if (filters?.refType && node.refType !== filters.refType) return false;
      if (filters?.subject && node.subject !== filters.subject) return false;
      return true;
    })
    .map((node) => ({
      ...node,
      score: cosineSimilarity(queryVector, node.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return matches.map((match) => ({
    ...match,
    embedding: match.embedding.slice(),
  }));
};

const executeToolCall = async (
  db: D1Database | undefined,
  tool: z.infer<typeof toolCallSchema>["tool"],
  params: Record<string, unknown>,
) => {
  if (tool === "search_learnings") {
    if (!db) {
      return { items: fallbackLearnings };
    }
    const query = learningListQuerySchema.parse({
      q: typeof params.q === "string" ? params.q : undefined,
      subject: typeof params.subject === "string" ? params.subject : undefined,
      tag: typeof params.tag === "string" ? params.tag : undefined,
      limit: params.limit ? Number(params.limit) : 10,
    });
    const { sql, binds } = buildLearningListQuery(query);
    const rows = await db.prepare(sql).bind(...binds).all<LearningWithStatsRow>();
    return { items: rows.results?.map(mapLearning) ?? [] };
  }

  if (tool === "create_learning_from_chat") {
    if (!db) throw new ToolCallError("db_unavailable", "Database is not available", 503);
    const title =
      typeof params.title === "string" && params.title.trim().length > 0
        ? params.title.trim()
        : undefined;
    if (!title) {
      throw new ToolCallError("invalid_params", "title is required");
    }
    const subject =
      typeof params.subject === "string" && params.subject.trim().length > 0
        ? params.subject.trim()
        : undefined;
    const tags = normalizeTagsInput(params.tags);
    const learning = await insertLearning(db, { title, subject, tags });
    return { learning };
  }

  if (tool === "generate_questions") {
    if (!db) throw new ToolCallError("db_unavailable", "Database is not available", 503);
    const normalizedTypes =
      Array.isArray(params.types) && params.types.length > 0
        ? params.types
            .map((value) => (typeof value === "string" ? value : ""))
            .filter(Boolean)
        : undefined;
    const request = generateFromMaterialRequestSchema.parse({
      learningId: params.learningId,
      materialId: params.materialId,
      types: normalizedTypes,
      presetId: params.presetId,
      presetTitle: params.presetTitle,
      presetSystemPrompt: params.presetSystemPrompt,
      presetUserTemplate: params.presetUserTemplate,
    });
    const learning = await fetchLearning(db, request.learningId);
    if (!learning) {
      throw new ToolCallError("not_found", "learning not found", 404);
    }
    const material =
      request.materialId && request.materialId.length > 0
        ? await fetchMaterial(db, request.materialId)
        : await fetchLatestMaterialForLearning(db, request.learningId);
    if (request.materialId && !material) {
      throw new ToolCallError("not_found", "material not found", 404);
    }
    const preset = await resolvePresetContext(db, request);
    const drafts = craftGeneratedContents(request, material, preset);
    const items: GeneratedContent[] = [];
    for (const draft of drafts) {
      items.push(await saveGeneratedContent(db, draft));
    }
    const job = buildGenerationJob(request.types, preset);
    return { material, items, job };
  }

  if (tool === "save_content") {
    if (!db) throw new ToolCallError("db_unavailable", "Database is not available", 503);
    const input = {
      learningId: params.learningId,
      materialId: params.materialId,
      type: params.type,
      content: params.content,
      promptPreset: params.promptPreset,
    };
    const parsed = z
      .object({
        learningId: z.string().uuid(),
        materialId: z.string().uuid().optional(),
        type: schemas.generatedContent.shape.type,
        content: z.record(z.string(), z.unknown()),
        promptPreset: z.string().min(1).optional(),
      })
      .safeParse(input);
    if (!parsed.success) {
      throw new ToolCallError("invalid_params", JSON.stringify(parsed.error.format()));
    }
    const saved = await saveGeneratedContent(db, parsed.data);
    return { content: saved };
  }

  throw new ToolCallError("unsupported_tool", `tool "${tool}" is not supported`, 400);
};

app.post("/ai/embed", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = embedRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const embeddings = parsed.data.texts.map((text) => toEmbedding(text));
  return c.json({
    dimension: EMBEDDING_DIMENSION,
    embeddings,
  });
});

app.post("/search/semantic", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = semanticSearchRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const { query, topK, refType, subject } = parsed.data;
  const results = await searchSemantic(c.env?.DB, query, topK, { refType, subject });

  return c.json({ query, topK, results });
});

app.post("/ai/tools", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = toolCallSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  try {
    const result = await executeToolCall(c.env?.DB, parsed.data.tool, parsed.data.params ?? {});
    return c.json({ tool: parsed.data.tool, result });
  } catch (error) {
    if (error instanceof ToolCallError) {
      return c.json({ error: error.code, message: error.message }, error.status);
    }
    console.error("tool call failed", error);
    return c.json(
      {
        error: "tool_failed",
        message: error instanceof Error ? error.message : "unknown error",
      },
      500,
    );
  }
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

  const topK = parsed.data.topK ?? 3;
  const related = await searchSemantic(c.env?.DB, parsed.data.prompt, topK);
  const toolCalls = [
    {
      tool: "embed",
      detail: `texts=1 dim=${EMBEDDING_DIMENSION}`,
    },
    {
      tool: "semantic_search",
      detail: `query="${parsed.data.prompt.slice(0, 32)}" topK=${topK}`,
      result: related[0]
        ? `${related[0].label} (score ${related[0].score})`
        : "no match",
    },
  ];

  const topHit = related[0];
  const summary =
    related.length === 0
      ? "関連する教材が見つからなかったので、新しい学習や問題セットを生成できます。テーマをもう少し具体的に教えてください。"
      : `関連候補: 「${topHit.label}」(score ${topHit.score}). 同じテーマで続けますか？`;

  return c.json({
    message: summary,
    request: parsed.data,
    exampleSchema: {
      learning: schemas.learning.keyof().options,
    },
    related,
    toolCalls,
  });
});

export default app;
