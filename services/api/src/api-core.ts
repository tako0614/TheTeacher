import {
  generateFromMaterialRequestSchema,
  materialIngestResultSchema,
  practiceFeedbackSchema,
  practiceGradingRequestSchema,
  authSessionResponseSchema,
  bootstrapSessionRequestSchema,
  issueSessionRequestSchema,
  updateUserProfileRequestSchema,
  schemas,
  type GenerateFromMaterialRequest,
  type GeneratedContent,
  type GenerationJob,
  type IngestJob,
  type IngestStep,
  type IngestSource,
  type Learning,
  type Material,
  type MaterialIngestRequest,
  type MaterialLibraryEntry,
  type PracticeFeedback,
  type PracticeGradingRequest,
  type PracticeSession,
  type Preset,
  type SemanticNode,
  type ExtractedSummary,
  type SimilarQuestion,
  type RichContentBlock,
  type RichContentDocument,
  type RichDiagramBlock,
  richContentDocumentSchema,
  type StructuredValue,
} from "@theteacher/shared";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { Prisma } from "@prisma/client/edge";
import type * as PdfJs from "pdfjs-dist/legacy/build/pdf.mjs";

import {
  parseJson,
  type GeneratedContentRow,
  type LearningWithStatsRow,
  type MaterialRow,
  type PracticeSessionRow,
  type PresetRow,
  type SemanticNodeRow,
} from "./db";
import { ToolCallError } from "./core/errors";
import type { AuthContext } from "./core/auth";
import { DEFAULT_USER_ID, fallbackUserContext, publicPaths, resolveAuthContext } from "./core/auth";
import {
  ensureCoreTables,
  getPrismaClient,
  nowIso,
} from "./core/prisma";
import {
  embedRequestSchema,
  ingestJobListQuerySchema,
  ingestMaterialRequestSchema,
  learningListQuerySchema,
  libraryEntryListQuerySchema,
  presetListQuerySchema,
  proxyRequestSchema,
  semanticSearchRequestSchema,
  toolCallSchema,
  updateLearningSchema,
  updateMaterialSchema,
  updatePresetSchema,
  upsertGeneratedSchema,
  upsertLearningSchema,
  upsertMaterialSchema,
  upsertPresetSchema,
  upsertSessionSchema,
} from "./core/schemas";
import { fetchIngestJob, fetchLibraryAsset, fetchLibraryEntryById, saveIngestJob } from "./core/library";
import type { AppBindings, AppEnv } from "./core/types";
import type { D1Database } from "@cloudflare/workers-types";

export const app = new Hono<AppEnv>();

declare module "hono" {
  interface ContextVariableMap {
    auth?: AuthContext;
  }
}

app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (publicPaths.has(path)) return next();

  const db = c.env.DB;
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

const mapLearning = (row: LearningWithStatsRow): Learning & {
  materialsCount: number;
  generatedCount: number;
  sessionCount: number;
  lastStudiedAt?: string;
} => {
  const createdAt =
    typeof row.createdAt === "string" ? row.createdAt : row.createdAt.toISOString();
  const updatedAt =
    typeof row.updatedAt === "string" ? row.updatedAt : row.updatedAt.toISOString();
  const lastStudied =
    row.lastStudiedAt === null || row.lastStudiedAt === undefined
      ? undefined
      : typeof row.lastStudiedAt === "string"
        ? row.lastStudiedAt
        : row.lastStudiedAt.toISOString();
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    subject: row.subject ?? undefined,
    tags:
      typeof row.tags === "string"
        ? parseJson<string[]>(row.tags)
        : (row.tags as unknown as string[] | undefined),
    progress: (row as { progress?: number | null }).progress ?? undefined,
    createdAt,
    updatedAt,
    materialsCount: (row as { materialsCount?: number }).materialsCount ?? 0,
    generatedCount: (row as { generatedCount?: number }).generatedCount ?? 0,
    sessionCount: (row as { sessionCount?: number }).sessionCount ?? 0,
    lastStudiedAt: lastStudied,
  };
};

const mapMaterial = (row: MaterialRow): Material => ({
  id: row.id,
  userId: row.userId,
  learningId: row.learningId,
  type: row.type,
  sourcePath: row.sourcePath ?? undefined,
  rawContent: row.rawContent ?? undefined,
  metadata:
    typeof row.metadata === "string"
      ? parseJson<Record<string, unknown>>(row.metadata)
      : (row.metadata as unknown as Record<string, unknown> | undefined),
  createdAt: typeof row.createdAt === "string" ? row.createdAt : row.createdAt.toISOString(),
  updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : row.updatedAt.toISOString(),
});

interface LibraryAssetPayload {
  bytes: Uint8Array;
  mimeType: string;
  size: number;
  fileName?: string;
}

const buildLibraryAssetPayload = (
  payload?: MaterialIngestRequest["payload"],
): LibraryAssetPayload | null => {
  if (!payload) return null;
  if (payload.dataUrl) {
    const decoded = decodeDataUrl(payload.dataUrl);
    return {
      bytes: decoded.bytes,
      mimeType: decoded.mimeType,
      size: decoded.size,
      fileName: payload.fileName,
    };
  }
  if (payload.text) {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(payload.text);
    return {
      bytes: encoded,
      mimeType: payload.mimeType ?? "text/plain; charset=utf-8",
      size: encoded.byteLength,
      fileName: payload.fileName,
    };
  }
  return null;
};

const mapGeneratedContent = (row: GeneratedContentRow): GeneratedContent => ({
  id: row.id,
  userId: row.userId,
  learningId: row.learningId,
  materialId: row.materialId ?? undefined,
  type: row.type,
  content:
    typeof row.content === "string"
      ? parseJson<Record<string, unknown>>(row.content) ?? {}
      : ((row.content as unknown as Record<string, unknown>) ?? {}),
  promptPreset: row.promptPreset ?? undefined,
  createdAt: typeof row.createdAt === "string" ? row.createdAt : row.createdAt.toISOString(),
});

const mapPracticeSession = (row: PracticeSessionRow): PracticeSession => ({
  id: row.id,
  userId: row.userId,
  learningId: row.learningId,
  generatedContentId: row.generatedContentId ?? undefined,
  questionRef:
    typeof row.questionRef === "string"
      ? parseJson<Record<string, unknown>>(row.questionRef)
      : ((row.questionRef as unknown as Record<string, unknown>) ?? undefined),
  answerText: row.answerText,
  isCorrect: row.isCorrect === null ? undefined : Boolean(row.isCorrect),
  feedback:
    typeof row.feedback === "string"
      ? parseJson<Record<string, unknown>>(row.feedback)
      : ((row.feedback as unknown as Record<string, unknown>) ?? undefined),
  score: typeof row.score === "number" ? row.score : undefined,
  createdAt: typeof row.createdAt === "string" ? row.createdAt : row.createdAt.toISOString(),
});

const clampProgress = (value: number) => Math.max(0, Math.min(1, value));

const calculateLearningProgress = async (db: D1Database, learningId: string, userId: string) => {
  const prisma = getPrismaClient(db);
  const sessions = await prisma.practiceSession.findMany({
    where: { learningId, userId },
    select: { score: true, isCorrect: true },
  });
  if (!sessions.length) return undefined;
  const values = sessions
    .map((session) =>
      session.score !== null && session.score !== undefined
        ? session.score
        : session.isCorrect === null || session.isCorrect === undefined
          ? undefined
          : session.isCorrect
            ? 1
            : 0,
    )
    .filter((value): value is number => typeof value === "number");
  if (!values.length) return undefined;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return clampProgress(avg);
};

const updateLearningProgress = async (db: D1Database, learningId: string, userId: string) => {
  const progress = await calculateLearningProgress(db, learningId, userId);
  if (progress === undefined) return;
  const prisma = getPrismaClient(db);
  await prisma.learning.update({
    where: { id: learningId },
    data: { progress, updatedAt: nowIso() },
  });
};

const mapPreset = (row: PresetRow): Preset => ({
  id: row.id,
  userId: row.userId,
  subject: row.subject,
  title: row.title,
  systemPrompt: row.systemPrompt,
  userInstructionTemplate: row.userInstructionTemplate,
  createdAt: typeof row.createdAt === "string" ? row.createdAt : row.createdAt.toISOString(),
  updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : row.updatedAt.toISOString(),
});

const insertLearning = async (
  db: D1Database,
  data: Pick<Learning, "title"> &
    Partial<Pick<Learning, "subject" | "tags" | "progress" | "id" | "createdAt" | "updatedAt">>,
  userId: string,
  env?: AppBindings,
): Promise<Learning> => {
  const id = data.id ?? crypto.randomUUID();
  const createdAt = data.createdAt ?? nowIso();
  const updatedAt = data.updatedAt ?? createdAt;
  const prisma = getPrismaClient(db);
  await prisma.learning.upsert({
    where: { id },
    create: {
      id,
      userId,
      title: data.title,
      subject: data.subject,
      tags: data.tags as unknown as Prisma.JsonValue,
      progress: data.progress,
      createdAt,
      updatedAt,
    },
    update: {
      title: data.title,
      subject: data.subject,
      tags: data.tags as unknown as Prisma.JsonValue,
      progress: data.progress,
      updatedAt,
    },
  });

  const learning = await fetchLearning(db, id, userId);
  const saved =
    learning ?? {
      id,
      userId,
      title: data.title,
      subject: data.subject,
      tags: data.tags,
      progress: data.progress,
      createdAt,
      updatedAt,
      materialsCount: 0,
      generatedCount: 0,
      sessionCount: 0,
    };
  await indexLearningSemanticNode(db, env, saved);
  return saved;
};

const ingestStepTemplates: Record<
  IngestSource["kind"] | "fallback",
  IngestJob["steps"]
> = {
  pdf: [
    { id: "download", label: "クラウド保存", kind: "download", status: "pending" },
    { id: "ocr", label: "ページOCR", kind: "ocr", status: "pending" },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  image: [
    { id: "download", label: "クラウド保存", kind: "download", status: "pending" },
    { id: "ocr", label: "OCR", kind: "ocr", status: "pending" },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  audio: [
    { id: "download", label: "クラウド保存", kind: "download", status: "pending" },
    { id: "transcription", label: "文字起こし", kind: "transcription", status: "pending" },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  video: [
    { id: "download", label: "クラウド保存", kind: "download", status: "pending" },
    { id: "transcription", label: "音声/字幕抽出", kind: "transcription", status: "pending" },
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

const PREPROCESS_STEP_KINDS = new Set<IngestStep["kind"]>([
  "download",
  "ocr",
  "transcription",
  "metadata",
]);

const fetchMaterial = async (db: D1Database, id: string, userId: string = DEFAULT_USER_ID) => {
  const prisma = getPrismaClient(db);
  const row = await prisma.material.findUnique({ where: { id } });
  if (!row || row.userId !== userId) return null;
  return mapMaterial(row as unknown as MaterialRow);
};

const applyMaterialMetadataPatch = async (
  db: D1Database,
  id: string,
  patch: (metadata: Record<string, unknown> | undefined) => Record<string, unknown> | undefined,
) => {
  const material = await fetchMaterial(db, id);
  if (!material) {
    throw new Error("material_not_found");
  }
  const nextMetadata = patch(material.metadata) ?? undefined;
  const updatedAt = nowIso();
  const prisma = getPrismaClient(db);
  await prisma.material.update({
    where: { id },
    data: {
      metadata: nextMetadata as unknown as Prisma.JsonValue,
      updatedAt,
    },
  });
  return {
    ...material,
    metadata: nextMetadata,
    updatedAt,
  };
};

const fetchLatestMaterialForLearning = async (
  db: D1Database,
  learningId: string,
  userId: string = DEFAULT_USER_ID,
) => {
  const prisma = getPrismaClient(db);
  const row = await prisma.material.findFirst({
    where: { learningId, userId },
    orderBy: { updatedAt: "desc" },
  });
  return row ? mapMaterial(row as unknown as MaterialRow) : null;
};

const saveGeneratedContent = async (
  db: D1Database,
  data: Omit<GeneratedContent, "id" | "createdAt"> &
    Partial<Pick<GeneratedContent, "id" | "createdAt">>,
  userId: string = DEFAULT_USER_ID,
  env?: AppBindings,
): Promise<GeneratedContent> => {
  const id = data.id ?? crypto.randomUUID();
  const createdAt = data.createdAt ?? nowIso();
  const prisma = getPrismaClient(db);

  const row = await prisma.generatedContent.upsert({
    where: { id },
    create: {
      id,
      userId,
      learningId: data.learningId,
      materialId: data.materialId ?? null,
      type: data.type,
      content: data.content as unknown as Prisma.JsonValue,
      promptPreset: data.promptPreset ?? null,
      createdAt,
    },
    update: {
      materialId: data.materialId ?? null,
      type: data.type,
      content: data.content as unknown as Prisma.JsonValue,
      promptPreset: data.promptPreset ?? null,
    },
  });
  const saved = mapGeneratedContent(row as unknown as GeneratedContentRow);
  const learning = await fetchLearning(db, saved.learningId, userId);
  await indexGeneratedContentSemanticNode(db, env, saved, learning?.subject ?? undefined);
  return saved;
};

const summarizeText = (text: string, limit = 280) =>
  text.replace(/\s+/g, " ").trim().slice(0, limit);

const countTokens = (text: string) => text.split(/\s+/).filter(Boolean).length;

interface MaterialChunkRecord {
  id: string;
  order: number;
  text: string;
  tokens: number;
  preview: string;
  embedding?: number[];
}

const chunkMaterialText = (
  text: string,
  options: { targetTokens?: number; maxTokens?: number } = {},
): MaterialChunkRecord[] => {
  const targetTokens = options.targetTokens ?? 180;
  const maxTokens = options.maxTokens ?? 260;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\t+/g, " ").trim();
  if (!normalized) return [];

  const segments = normalized
    .split(/(?<=[。．.!?！？])\s+|\n{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const chunks: MaterialChunkRecord[] = [];
  let buffer = "";
  let bufferTokens = 0;

  const pushChunk = () => {
    const trimmed = buffer.trim();
    if (!trimmed) return;
    chunks.push({
      id: crypto.randomUUID(),
      order: chunks.length,
      text: trimmed,
      tokens: countTokens(trimmed),
      preview: summarizeText(trimmed, 160),
    });
    buffer = "";
    bufferTokens = 0;
  };

  const sourceSegments = segments.length > 0 ? segments : [normalized];

  for (const segment of sourceSegments) {
    const segmentTokens = countTokens(segment);
    const tentative = buffer ? `${buffer}\n${segment}` : segment;
    const tentativeTokens = bufferTokens + segmentTokens;

    if (buffer && tentativeTokens > maxTokens) {
      pushChunk();
      buffer = segment;
      bufferTokens = segmentTokens;
      continue;
    }

    buffer = tentative;
    bufferTokens = tentativeTokens;

    if (bufferTokens >= targetTokens) {
      pushChunk();
    }
  }

  if (buffer.trim()) {
    pushChunk();
  }

  if (chunks.length === 0) {
    chunks.push({
      id: crypto.randomUUID(),
      order: 0,
      text: normalized,
      tokens: countTokens(normalized),
      preview: summarizeText(normalized, 160),
    });
  }

  return chunks;
};

const attachEmbeddingsToChunks = async (
  chunks: MaterialChunkRecord[],
  env?: AppBindings,
): Promise<{
  chunks: MaterialChunkRecord[];
  dimension: number;
  provider: EmbeddingProvider;
  model?: string;
}> => {
  const { embeddings, dimension, provider, model } = await generateEmbeddings(
    chunks.map((chunk) => chunk.text),
    env,
  );
  return {
    chunks: chunks.map((chunk, index) => ({
      ...chunk,
      embedding: embeddings[index] ?? toEmbedding(chunk.text, dimension),
    })),
    dimension,
    provider,
    model,
  };
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

interface IngestQueueItem {
  db: D1Database;
  jobId: string;
  materialId: string;
  learningId?: string;
  text?: string | null;
  env?: AppBindings;
}

const ingestQueue: (IngestQueueItem & { deferred: Deferred<void> })[] = [];
let ingestQueueRunning = false;

const persistChunkMetadata = async (
  db: D1Database,
  materialId: string,
  jobId: string,
  chunks: MaterialChunkRecord[],
) => {
  const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.tokens, 0);
  const chunkSummaries = chunks.map(({ embedding, ...rest }) => {
    void embedding;
    return rest;
  });
  const now = nowIso();
  await applyMaterialMetadataPatch(db, materialId, (metadata = {}) => ({
    ...metadata,
    chunking: {
      jobId,
      chunkCount: chunks.length,
      totalTokens,
      updatedAt: now,
    },
    chunks: chunkSummaries,
    lastChunkedAt: now,
  }));
};

const persistEmbeddingMetadata = async (
  db: D1Database,
  materialId: string,
  jobId: string,
  chunks: MaterialChunkRecord[],
  meta: { dimension: number; provider: EmbeddingProvider; model?: string },
) => {
  const now = nowIso();
  await applyMaterialMetadataPatch(db, materialId, (metadata = {}) => ({
    ...metadata,
    chunkEmbeddings: chunks.map((chunk) => ({
      id: chunk.id,
      order: chunk.order,
      embedding: chunk.embedding,
    })),
    embedding: {
      jobId,
      dimension: meta.dimension,
      chunkCount: chunks.length,
      provider: meta.provider,
      model: meta.model,
      updatedAt: now,
    },
    embeddingReadyAt: now,
  }));
};

const enqueueIngestJobProcessing = (item: IngestQueueItem) => {
  const deferred = createDeferred<void>();
  ingestQueue.push({ ...item, deferred });
  drainIngestQueue();
  return deferred.promise;
};

const drainIngestQueue = () => {
  if (ingestQueueRunning) return;
  const next = ingestQueue.shift();
  if (!next) return;
  ingestQueueRunning = true;
  processIngestQueueItem(next)
    .then(() => next.deferred.resolve())
    .catch((error) => {
      console.error("ingest pipeline crashed", error);
      next.deferred.reject(error);
    })
    .finally(() => {
      ingestQueueRunning = false;
      drainIngestQueue();
    });
};

const processIngestQueueItem = async (item: IngestQueueItem & { deferred: Deferred<void> }) => {
  let job = await fetchIngestJob(item.db, item.jobId);
  if (!job) return;
  let material = await fetchMaterial(item.db, item.materialId);
  if (!material) {
    job = setJobStatus(job, "failed");
    await saveIngestJob(item.db, job);
    return;
  }

  const metadata = (material.metadata ?? {}) as Record<string, unknown>;
  const libraryEntryId =
    typeof metadata.libraryEntryId === "string" ? metadata.libraryEntryId : undefined;
  const payloadEncoding =
    typeof metadata.payloadEncoding === "string" ? metadata.payloadEncoding : undefined;
  const preferOffline = (job.notes ?? "").includes("prefer_offline");

  let entry: MaterialLibraryEntry | null = null;
  let asset:
    | {
        bytes: Uint8Array;
        mimeType: string;
        fileName?: string;
      }
    | null = null;
  let cachedChunks: MaterialChunkRecord[] | undefined;
  let ocrDetails: Record<string, unknown> | undefined;
  let transcriptionDetails:
    | (Record<string, unknown> & { subtitleSrt?: string; subtitles?: { format: "srt"; value: string } })
    | undefined;
  const state = {
    text: (item.text ?? material.rawContent ?? "").trim() || undefined,
  };

  const loadAsset = async () => {
    if (asset) return;
    if (!libraryEntryId) return;
    entry = entry ?? (await fetchLibraryEntryById(item.db, libraryEntryId));
    const stored = await fetchLibraryAsset(item.db, libraryEntryId);
    if (!stored?.data) return;
    const bytes = new Uint8Array(stored.data);
    asset = {
      bytes,
      mimeType: stored.mimeType,
      fileName: entry?.displayName ?? (metadata.payloadFileName as string | undefined),
    };
    const treatAsText =
      payloadEncoding === "text" || stored.mimeType.startsWith("text/");
    if (!state.text && treatAsText) {
      try {
        state.text = new TextDecoder().decode(bytes).trim();
      } catch {
        state.text = undefined;
      }
    }
  };

  const failJob = async (stepId: string | undefined, message: string) => {
    if (stepId) {
      job = setJobStepStatus(job, stepId, "failed", message);
    }
    job = setJobStatus(job, "failed");
    await saveIngestJob(item.db, job);
  };

  const ensureTextAvailable = () => {
    if (!state.text) {
      throw new Error("material_missing_raw_content");
    }
  };

  const stepHandlers: Record<IngestStep["kind"], () => Promise<void>> = {
    download: async () => {
      if (state.text) return;
      await loadAsset();
      if (!asset && !state.text) {
        throw new Error("library_asset_missing");
      }
    },
    ocr: async () => {
      if (state.text) return;
      await loadAsset();
      if (!asset) {
        throw new Error("ocr_asset_missing");
      }
      if (asset.mimeType.includes("pdf") || job.source.kind === "pdf") {
        const text = await extractTextFromPdfBytes(asset.bytes);
        if (text && text.trim().length > 0) {
          state.text = text;
          ocrDetails = {
            engine: job.preferredOcrEngine ?? "pdfjs",
          };
          return;
        }
        if (preferOffline) {
          throw new Error("ocr_pdf_empty");
        }
        const dataUrl = encodeDataUrlFromBytes(asset.bytes, asset.mimeType);
        const { text: visionText, model } = await visionOcrWithOpenAi(item.env, dataUrl);
        if (!visionText) {
          throw new Error("ocr_pdf_empty");
        }
        state.text = visionText;
        ocrDetails = {
          engine: job.preferredOcrEngine ?? "openai_vision",
          model,
        };
        return;
      }
      if (preferOffline) {
        state.text = summarizeText(
          `[image_offline_ocr] ${asset.fileName ?? job.source.path ?? "image"}`,
        );
        ocrDetails = {
          engine: job.preferredOcrEngine ?? "native_tesseract",
        };
        return;
      }
      const dataUrl = encodeDataUrlFromBytes(asset.bytes, asset.mimeType);
      const { text, model } = await visionOcrWithOpenAi(item.env, dataUrl);
      if (!text) {
        throw new Error("ocr_result_empty");
      }
      state.text = text;
      ocrDetails = {
        engine: job.preferredOcrEngine ?? "openai_vision",
        model,
      };
    },
    transcription: async () => {
      if (state.text) return;
      await loadAsset();
      if (!asset) {
        throw new Error("transcription_asset_missing");
      }
      const transcriptionEngine = preferOffline
        ? job.preferredTranscriptionEngine ?? "whisper_rs"
        : "openai_whisper";
      if (preferOffline) {
        state.text = summarizeText(
          `[transcription_pending_offline] ${asset.fileName ?? job.source.path ?? "audio"}`,
        );
        transcriptionDetails = {
          engine: transcriptionEngine,
        };
        return;
      }
      const payload = {
        mimeType: asset.mimeType,
        bytes: asset.bytes,
        size: asset.bytes.byteLength,
      };
      const includeSegments = job.source.kind === "video";
      const { text, model, subtitleSrt } = await transcribeWithOpenAi(item.env, payload, {
        fileName: asset.fileName,
        includeSegments,
      });
      if (!text) {
        throw new Error("transcription_empty");
      }
      state.text = text;
      transcriptionDetails = {
        engine: transcriptionEngine,
        model,
        subtitleSrt,
        subtitles: subtitleSrt ? { format: "srt", value: subtitleSrt } : undefined,
      };
    },
    metadata: async () => {
      ensureTextAvailable();
      material = await persistMaterialRawContent(
        item.db,
        material,
        state.text!,
        detectExtractedFormat(job.source.kind),
        {
          ocr: ocrDetails,
          transcription: transcriptionDetails,
        },
        transcriptionDetails?.subtitles ? { subtitles: transcriptionDetails.subtitles } : undefined,
      );
    },
    chunking: async () => {
      ensureTextAvailable();
      const generated = chunkMaterialText(state.text!);
      if (!generated.length) {
        throw new Error("chunk_generation_empty");
      }
      cachedChunks = generated;
      await persistChunkMetadata(item.db, item.materialId, job.id, generated);
    },
    embedding: async () => {
      const preparedChunks = cachedChunks ?? chunkMaterialText(state.text ?? "");
      if (!preparedChunks.length) {
        throw new Error("embedding_missing_chunks");
      }
      const prepared = await attachEmbeddingsToChunks(preparedChunks, item.env);
      await persistEmbeddingMetadata(item.db, item.materialId, job.id, prepared.chunks, {
        dimension: prepared.dimension,
        provider: prepared.provider,
        model: prepared.model,
      });
    },
  };

  for (const step of job.steps) {
    if (step.status === "succeeded") continue;
    if (step.status === "failed") return;
    const handler = stepHandlers[step.kind];
    if (!handler) continue;

    if (step.status === "pending") {
      job = setJobStepStatus(job, step.id, "running");
      job = await saveIngestJob(item.db, job);
    }

    try {
      await handler();
      job = await saveIngestJob(item.db, setJobStepStatus(job, step.id, "succeeded"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "pipeline_step_failed";
      await failJob(step.id, message);
      return;
    }
  }

  if (job.steps.every((step) => step.status === "succeeded")) {
    job = setJobStatus(job, "completed");
    await saveIngestJob(item.db, job);
  }
};


const stripHtml = (value: string) =>
  value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractHtmlSummary = (html: string) => {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescriptionMatch =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const title = titleMatch?.[1]?.trim();
  const description = metaDescriptionMatch?.[1]?.trim();
  const cleaned = stripHtml(html);
  return [title, description, cleaned].filter(Boolean).join("\n").slice(0, 16_000);
};

const fetchRemoteText = async (url: string): Promise<string> => {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = await res.json().catch(() => null);
    return typeof json === "string" ? json : JSON.stringify(json ?? {});
  }
  const raw = await res.text();
  if (contentType.includes("html")) return extractHtmlSummary(raw);
  return raw.slice(0, 16_000);
};

const defaultOpenAiBaseUrl = "https://api.openai.com/v1";

interface DataUrlPayload {
  mimeType: string;
  bytes: Uint8Array;
  size: number;
}

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const isHttpUrl = (value?: string) => typeof value === "string" && /^https?:\/\//i.test(value);

const decodeBase64 = (value: string) => {
  if (typeof atob === "function") return atob(value);
  const globalBuffer = (globalThis as {
    Buffer?: { from(input: string, encoding: string): { toString(encoding: string): string } };
  }).Buffer;
  if (globalBuffer) {
    return globalBuffer.from(value, "base64").toString("binary");
  }
  throw new Error("base64 decoding is not supported in this environment");
};

const decodeDataUrl = (dataUrl: string): DataUrlPayload => {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/i);
  if (!match) {
    throw new Error("invalid data url payload");
  }
  const [, mimeType, base64Content] = match;
  const normalized = base64Content.replace(/\s/g, "");
  const binary = decodeBase64(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return {
    mimeType: mimeType || "application/octet-stream",
    bytes,
    size: bytes.byteLength,
  };
};

const fetchRemoteBinary = async (
  url: string,
  sizeLimit = MAX_MEDIA_BYTES,
): Promise<DataUrlPayload> => {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`failed to fetch ${url}: ${res.status}`);
  }
  const declaredSize = res.headers.get("content-length");
  const contentLength = declaredSize ? Number(declaredSize) : undefined;
  if (typeof contentLength === "number" && Number.isFinite(contentLength) && contentLength > sizeLimit) {
    throw new Error(
      `媒体ファイルが大きすぎます (${(contentLength / 1024 / 1024).toFixed(1)} MB)。${(
        sizeLimit / 1024 / 1024
      ).toFixed(0)}MB 以内にしてください。`,
    );
  }
  const arrayBuffer = await res.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.byteLength > sizeLimit) {
    throw new Error(
      `媒体ファイルが大きすぎます (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB)。${(
        sizeLimit / 1024 / 1024
      ).toFixed(0)}MB 以内にしてください。`,
    );
  }
  const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
  return {
    mimeType,
    bytes,
    size: bytes.byteLength,
  };
};

const resolveOpenAiBaseUrl = (env?: AppBindings) =>
  (env?.OPENAI_API_BASE_URL?.trim() || defaultOpenAiBaseUrl).replace(/\/$/, "");

const joinChatContent = (content: unknown): string => {
  if (!content) return "";
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .join(" ")
      .trim();
  }
  return "";
};

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

const formatSrtTimestamp = (value: number) => {
  const totalMs = Math.max(0, Math.round(value * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const milliseconds = totalMs % 1000;
  const pad = (num: number, size: number) => String(num).padStart(size, "0");
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(milliseconds, 3)}`;
};

const segmentsToSrt = (segments: TranscriptSegment[]) =>
  segments
    .map((segment, index) => {
      const start = formatSrtTimestamp(segment.start);
      const end = formatSrtTimestamp(segment.end);
      const text = segment.text.trim();
      return `${index + 1}\n${start} --> ${end}\n${text}`;
    })
    .join("\n\n")
    .trim();

const transcribeWithOpenAi = async (
  env: AppBindings | undefined,
  data: DataUrlPayload,
  details?: { fileName?: string; includeSegments?: boolean },
) => {
  const apiKey = env?.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured for transcription");
  }
  const model = env?.OPENAI_TRANSCRIPTION_MODEL?.trim() || "whisper-1";
  const form = new FormData();
  form.append(
    "file",
    new File([data.bytes.buffer as ArrayBuffer], details?.fileName || `material-${Date.now()}`, { type: data.mimeType }),
  );
  form.append("model", model);
  form.append("response_format", details?.includeSegments ? "verbose_json" : "json");
  form.append("temperature", "0");
  form.append("language", "ja");
  const response = await fetch(`${resolveOpenAiBaseUrl(env)}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`OpenAI transcription failed (${response.status}): ${detail}`);
  }
  if (details?.includeSegments) {
    const json = (await response.json()) as {
      text?: string;
      segments?: { start?: number; end?: number; text?: string }[];
    };
    const segments: TranscriptSegment[] = Array.isArray(json.segments)
      ? json.segments
          .map((segment) => ({
            start: typeof segment.start === "number" ? segment.start : Number(segment.start ?? NaN),
            end: typeof segment.end === "number" ? segment.end : Number(segment.end ?? NaN),
            text: typeof segment.text === "string" ? segment.text.trim() : String(segment.text ?? "").trim(),
          }))
          .filter(
            (segment) =>
              Number.isFinite(segment.start) &&
              Number.isFinite(segment.end) &&
              segment.text.length > 0,
          )
      : [];
    const subtitleSrt = segments.length ? segmentsToSrt(segments) : undefined;
    const text = (json.text ?? segments.map((segment) => segment.text).join("\n")).trim();
    if (!text) {
      throw new Error("OpenAI transcription response did not contain text");
    }
    return { text, model, segments, subtitleSrt };
  }
  const json = (await response.json()) as { text?: string };
  const text = json.text?.trim() ?? "";
  if (!text) {
    throw new Error("OpenAI transcription response did not contain text");
  }
  return { text, model };
};

const visionOcrWithOpenAi = async (env: AppBindings | undefined, dataUrl: string) => {
  const apiKey = env?.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured for OCR");
  }
  const model = env?.OPENAI_VISION_MODEL?.trim() || env?.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const response = await fetch(`${resolveOpenAiBaseUrl(env)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: "You are an OCR assistant. Extract readable text verbatim and reply with plain text.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract the text from this image. Return only the text content with preserved newlines where appropriate.",
            },
            {
              type: "image_url",
              image_url: {
                url: dataUrl,
                detail: "high",
              },
            },
          ],
        },
      ],
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`OpenAI vision request failed (${response.status}): ${detail}`);
  }
  const json = (await response.json()) as { choices?: { message?: { content?: unknown } }[]; model?: string };
  const content = joinChatContent(json.choices?.[0]?.message?.content);
  if (!content) {
    throw new Error("OpenAI vision response did not contain any text");
  }
  return { text: content, model };
};

type PdfJsLib = typeof PdfJs;
let pdfjsLibPromise: Promise<PdfJsLib> | null = null;

const loadPdfjs = async (): Promise<PdfJsLib> => {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((mod) => {
      // Disable worker usage to stay within Workers runtime constraints.
      if (mod.GlobalWorkerOptions) {
        mod.GlobalWorkerOptions.workerSrc = undefined;
      }
      return mod as PdfJsLib;
    });
  }
  return pdfjsLibPromise;
};

const encodeBase64 = (bytes: Uint8Array) => {
  if (typeof btoa === "function") {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }
  const buffer = (globalThis as {
    Buffer?: { from(input: Uint8Array): { toString(encoding: string): string } };
  }).Buffer;
  if (buffer) {
    return buffer.from(bytes).toString("base64");
  }
  throw new Error("base64 encoding is not supported in this environment");
};

const encodeDataUrlFromBytes = (bytes: Uint8Array, mimeType: string) =>
  `data:${mimeType || "application/octet-stream"};base64,${encodeBase64(bytes)}`;

const extractTextFromPdfBytes = async (bytes: Uint8Array): Promise<string> => {
  const pdfjs = await loadPdfjs();
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  const totalPages = Math.min(document.numPages, 10);
  let text = "";
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items as ({ str?: string } | string)[];
    const pageText = items
      .map((item) =>
        typeof item === "string" ? item : typeof item?.str === "string" ? item.str : "",
      )
      .join(" ")
      .trim();
    if (pageText) {
      text += `${pageText}\n\n`;
    }
  }
  await document.destroy();
  return text.trim();
};

const detectExtractedFormat = (source: IngestSource["kind"]): ExtractedSummary["format"] => {
  if (source === "audio" || source === "video") return "transcript";
  if (source === "image" || source === "pdf") return "ocr";
  if (source === "url") return "scraped";
  return "plain";
};

const persistMaterialRawContent = async (
  db: D1Database,
  material: Material,
  text: string,
  format: ExtractedSummary["format"],
  details?: Record<string, unknown>,
  metadataPatch?: Record<string, unknown>,
) => {
  const trimmed = text.trim();
  const updatedAt = nowIso();
  const prisma = getPrismaClient(db);
  await prisma.material.update({
    where: { id: material.id },
    data: { rawContent: trimmed, updatedAt },
  });
  const preview = summarizeText(trimmed);
  const tokens = countTokens(trimmed);
  await applyMaterialMetadataPatch(db, material.id, (metadata = {}) => ({
    ...metadata,
    ...(metadataPatch ?? {}),
    extracted: {
      preview,
      tokens,
      format,
      updatedAt,
      details,
    },
  }));
  return {
    ...material,
    rawContent: trimmed,
    metadata: {
      ...((material.metadata ?? {}) as Record<string, unknown>),
      ...(metadataPatch ?? {}),
      extracted: {
        preview,
        tokens,
        format,
        updatedAt,
        details,
      },
    },
    updatedAt,
  };
};

const extractMaterialFromSource = async (
  source: IngestSource,
  preferOffline = false,
  payload?: MaterialIngestRequest["payload"],
  env?: AppBindings,
) => {
  const payloadText = payload?.text?.trim();
  if (payloadText) {
    const preview = summarizeText(payloadText);
    return {
      rawContent: payloadText,
      extracted: {
        preview,
        tokens: countTokens(payloadText),
        format:
          source.kind === "image"
            ? ("ocr" as const)
            : source.kind === "audio" || source.kind === "video"
              ? ("transcript" as const)
              : ("plain" as const),
      },
      metadata: {
        sourceLabel: source.kind,
        payloadFileName: payload?.fileName,
        payloadBytes: payload?.bytes,
        payloadMimeType: payload?.mimeType,
        payloadDataUrlPreview: payload?.dataUrl?.slice(0, 120),
      },
    };
  }

  const dataUrl = payload?.dataUrl;
  if (dataUrl && typeof dataUrl === "string") {
    const payloadData = payload!;
    if (source.kind === "audio" || source.kind === "video") {
      if (preferOffline) {
        const placeholder = `[transcription_pending_offline] ${payloadData.fileName ?? source.path ?? "media"}`;
        const preview = summarizeText(placeholder);
        return {
          rawContent: placeholder,
          extracted: {
            preview,
            tokens: preview.split(/\s+/).filter(Boolean).length,
            format: "transcript" as const,
          },
          metadata: {
            sourceLabel: `${source.kind}_offline`,
            payloadFileName: payloadData.fileName,
            payloadBytes: payloadData.bytes,
            payloadMimeType: payloadData.mimeType,
            payloadDataUrlPreview: dataUrl.slice(0, 120),
          },
        };
      }
      const decoded = decodeDataUrl(dataUrl);
      const includeSegments = source.kind === "video";
      const { text, model, subtitleSrt } = await transcribeWithOpenAi(env, decoded, {
        fileName: payloadData.fileName,
        includeSegments,
      });
      const preview = summarizeText(text);
      return {
        rawContent: text,
        extracted: {
          preview,
          tokens: countTokens(text),
          format: "transcript" as const,
        },
        metadata: {
          sourceLabel: `${source.kind}_transcribed`,
          payloadFileName: payloadData.fileName,
          payloadBytes: payloadData.bytes ?? decoded.size,
          payloadMimeType: payloadData.mimeType ?? decoded.mimeType,
          openAiModel: model,
          payloadDataUrlPreview: dataUrl.slice(0, 120),
          subtitles: subtitleSrt ? { format: "srt", value: subtitleSrt } : undefined,
        },
      };
    }

    if (source.kind === "image") {
      if (preferOffline) {
        const placeholder = `[image_offline_ocr] ${payloadData.fileName ?? source.path ?? "image"}`;
        const preview = summarizeText(placeholder);
        return {
          rawContent: placeholder,
          extracted: {
            preview,
            tokens: preview.split(/\s+/).filter(Boolean).length,
            format: "ocr" as const,
          },
          metadata: {
            sourceLabel: "image_ocr_offline",
            payloadFileName: payloadData.fileName,
            payloadBytes: payloadData.bytes,
            payloadMimeType: payloadData.mimeType,
            payloadDataUrlPreview: dataUrl.slice(0, 120),
          },
        };
      }
      const { text, model } = await visionOcrWithOpenAi(env, dataUrl);
      const preview = summarizeText(text);
      return {
        rawContent: text,
        extracted: {
          preview,
          tokens: countTokens(text),
          format: "ocr" as const,
        },
        metadata: {
          sourceLabel: "image_ocr",
          payloadFileName: payloadData.fileName,
          payloadBytes: payloadData.bytes,
          payloadMimeType: payloadData.mimeType,
          openAiModel: model,
          payloadDataUrlPreview: dataUrl.slice(0, 120),
        },
      };
    }
  }

  if (source.kind === "audio" || source.kind === "video") {
    const placeholder = `[transcription_pending${preferOffline ? "_offline" : ""}] ${source.path || "media"}`;
    if (preferOffline) {
      const preview = summarizeText(placeholder);
      return {
        rawContent: placeholder,
        extracted: {
          preview,
          tokens: preview.split(/\s+/).filter(Boolean).length,
          format: "transcript" as const,
        },
        metadata: { sourceLabel: `${source.kind}_offline`, payloadFileName: payload?.fileName },
      };
    }

    if (isHttpUrl(source.path)) {
      const remotePayload = await fetchRemoteBinary(source.path);
      const includeSegments = source.kind === "video";
      const { text, model, subtitleSrt } = await transcribeWithOpenAi(env, remotePayload, {
        fileName: payload?.fileName ?? source.path.split("/").pop(),
        includeSegments,
      });
      const preview = summarizeText(text);
      return {
        rawContent: text,
        extracted: {
          preview,
          tokens: countTokens(text),
          format: "transcript" as const,
        },
        metadata: {
          sourceLabel: `${source.kind}_transcribed_remote`,
          payloadFileName: payload?.fileName ?? source.path,
          payloadBytes: remotePayload.size,
          payloadMimeType: remotePayload.mimeType,
          openAiModel: model,
          subtitles: subtitleSrt ? { format: "srt", value: subtitleSrt } : undefined,
        },
      };
    }

    throw new Error("音声/動画の取り込みにはpayloadまたは有効なURLが必要です。");
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
      tokens: countTokens(rawContent),
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
    libraryPath: libraryPath ?? "materials",
  };
};

const cloneIngestJob = (job: IngestJob): IngestJob => ({
  ...job,
  steps: job.steps.map((step) => ({ ...step })),
});

const setJobStepStatus = (
  job: IngestJob,
  stepId: string,
  status: IngestStep["status"],
  error?: string,
) => {
  const now = nowIso();
  const steps = job.steps.map((step) => {
    if (step.id !== stepId) return step;
    return {
      ...step,
      status,
      error,
      startedAt: step.startedAt ?? now,
      finishedAt: status === "succeeded" || status === "failed" ? now : undefined,
    };
  });
  return {
    ...job,
    steps,
    updatedAt: now,
  };
};

const prepareJobForProcessing = (job: IngestJob): IngestJob => {
  const now = nowIso();
  if (job.steps.some((step) => step.status === "running")) {
    return {
      ...job,
      updatedAt: now,
    };
  }
  let firstPendingMarked = false;
  const steps = job.steps.map((step) => {
    if (!firstPendingMarked && step.status === "pending") {
      firstPendingMarked = true;
      return {
        ...step,
        status: "running",
        startedAt: step.startedAt ?? now,
        error: undefined,
      };
    }
    return step;
  });
  const hasWork = steps.some((step) => step.status === "running" || step.status === "pending");
  return {
    ...job,
    steps,
    status: hasWork ? "processing" : "completed",
    updatedAt: now,
  };
};

const setJobStatus = (job: IngestJob, status: IngestJob["status"]) => ({
  ...job,
  status,
  updatedAt: nowIso(),
});

const buildLibraryEntryRecord = (
  material: Material,
  request: MaterialIngestRequest,
  options?: {
    entryId?: string;
    notes?: string;
    assetPath?: string;
    storageKey?: string;
    bytesOverride?: number;
  },
): MaterialLibraryEntry => {
  const originalPath =
    request.source.kind === "url"
      ? request.source.url
      : request.source.kind === "text"
        ? `${material.id}.txt`
        : request.source.path ?? material.sourcePath ?? material.id;
  const storedPath = options?.storageKey ?? originalPath;
  const displayName =
    request.payload?.fileName ??
    material.sourcePath ??
    `${material.type.toUpperCase()}_${material.id.slice(0, 8)}`;
  const inferredLibraryPath =
    options?.storageKey ??
    (request.source.kind === "text"
      ? `${material.learningId}/${material.id}.txt`
      : request.source.kind === "url"
        ? request.source.url
        : request.source.path ?? request.payload?.fileName ?? storedPath);

  return {
    id: options?.entryId ?? crypto.randomUUID(),
    userId: material.userId,
    displayName,
    storedPath,
    libraryPath: inferredLibraryPath,
    assetPath: options?.assetPath,
    type: material.type,
    bytes: request.payload?.bytes ?? options?.bytesOverride,
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
    .split(/(?<=[。.!?])\s+/)
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

interface PresetContext {
  title?: string;
  systemPrompt?: string;
  userTemplate?: string;
}

const buildGenerationJob = (
  types: GenerateFromMaterialRequest["types"],
  preset?: PresetContext,
  details?: { modelName?: string; tokens?: number },
): GenerationJob => {
  const noteParts = [
    preset?.title ? `preset="${preset.title}"` : undefined,
    details?.modelName ? `model="${details.modelName}"` : undefined,
    typeof details?.tokens === "number" && Number.isFinite(details.tokens)
      ? `tokens=${Math.round(details.tokens)}`
      : undefined,
  ].filter(Boolean);

  return {
    createdAt: nowIso(),
    completedAt: nowIso(),
    presetTitle: preset?.title,
    types,
    notes: noteParts.length ? noteParts.join(" ") : undefined,
  };
};

const condenseIdea = (text: string, limit = 120) => summarizeText(text, limit).replace(/\s+/g, " ");

const sanitizeLabel = (text: string, limit = 48) =>
  condenseIdea(text, limit)
    .replace(/[\n\r]+/g, " ")
    .trim();

const cleanMaterialText = (value?: string) =>
  typeof value === "string" ? value.replaceAll("\u0000", " ").trim() : "";

const createAdhocMaterialFromText = async (
  db: D1Database,
  learning: Learning,
  text: string,
  env?: AppBindings,
  options?: { title?: string; sourceLabel?: string },
): Promise<Material> => {
  const normalized = cleanMaterialText(text).slice(0, MATERIAL_CONTEXT_CHAR_LIMIT);
  if (!normalized) {
    throw new ToolCallError(
      "material_empty",
      "materialText is empty; provide a prompt or upload content first.",
      400,
    );
  }
  const now = nowIso();
  const id = crypto.randomUUID();
  const title =
    sanitizeLabel(options?.title ?? condenseIdea(normalized, 80), 80) || "AIチャット生成教材";
  const material: Material = {
    id,
    userId: learning.userId,
    learningId: learning.id,
    type: "text",
    sourcePath: title,
    rawContent: normalized,
    metadata: {
      sourceLabel: options?.sourceLabel ?? "ai_chat_prompt",
      preview: summarizeText(normalized, 200),
      createdFrom: "proxy_chat",
      promptTitle: options?.title,
    },
    createdAt: now,
    updatedAt: now,
  };

  const prisma = getPrismaClient(db);
  await prisma.material.upsert({
    where: { id: material.id },
    create: {
      id: material.id,
      userId: learning.userId,
      learningId: material.learningId,
      type: material.type,
      sourcePath: material.sourcePath,
      rawContent: material.rawContent,
      metadata: material.metadata as unknown as Prisma.JsonValue,
      createdAt: material.createdAt,
      updatedAt: material.updatedAt,
    },
    update: {
      sourcePath: material.sourcePath,
      rawContent: material.rawContent,
      metadata: material.metadata as unknown as Prisma.JsonValue,
      updatedAt: material.updatedAt,
    },
  });
  await indexMaterialSemanticNode(db, env, material, learning.subject ?? undefined);
  return material;
};

const resolveMaterialForGeneration = async (
  db: D1Database,
  env: AppBindings | undefined,
  request: GenerateFromMaterialRequest,
  learning: Learning,
  userId: string = learning.userId,
): Promise<{ material: Material; createdFromText: boolean }> => {
  const fallbackText = cleanMaterialText(request.materialText).slice(0, MATERIAL_CONTEXT_CHAR_LIMIT);
  const existing =
    request.materialId && request.materialId.length > 0
      ? await fetchMaterial(db, request.materialId, userId)
      : await fetchLatestMaterialForLearning(db, request.learningId, userId);

  if (existing?.rawContent?.trim()) {
    return { material: existing, createdFromText: false };
  }

  if (fallbackText) {
    if (existing) {
      const updatedAt = nowIso();
      const source = existing.sourcePath ?? request.materialTitle ?? condenseIdea(fallbackText, 80);
      const prisma = getPrismaClient(db);
      await prisma.material.update({
        where: { id: existing.id },
        data: { rawContent: fallbackText, sourcePath: source, updatedAt },
      });
      const refreshed = await fetchMaterial(db, existing.id, userId);
      if (refreshed) {
        await indexMaterialSemanticNode(db, env, refreshed, learning.subject ?? undefined);
        return { material: refreshed, createdFromText: true };
      }
    }
    const material = await createAdhocMaterialFromText(db, learning, fallbackText, env, {
      title: request.materialTitle,
      sourceLabel: "ai_chat_prompt",
    });
    return { material, createdFromText: true };
  }

  if (existing) {
    throw new ToolCallError(
      "material_empty",
      "This material does not contain extracted text. Provide materialText or upload content first.",
      400,
    );
  }

  throw new ToolCallError(
    "material_not_found",
    "No material available for generation. Provide materialText or upload content first.",
    404,
  );
};

const latexSafe = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/([{}_#%&$])/g, "\\$1")
    .replace(/\s+/g, " ");

const buildConceptDiagram = (ideas: string[], title: string): RichDiagramBlock => {
  const nodes = (ideas.length ? ideas : ["教材の要点"])
    .slice(0, 4)
    .map((idea, index) => ({
      id: `node-${index}`,
      label: sanitizeLabel(idea, 18) || `概念${index + 1}`,
      description: condenseIdea(idea, 60),
    }));
  const edges = nodes
    .slice(1)
    .map((node, index) => ({
      from: nodes[index].id,
      to: node.id,
      label: `関連 ${index + 1}`,
    }));
  return {
    type: "diagram",
    title,
    description: "教材内の概念間のつながりを示す簡易レイアウト",
    layout: nodes.length > 2 ? "horizontal" : "vertical",
    nodes,
    edges,
  };
};

const buildScoreFormula = (label: string, denominator: number) =>
  `\\text{${latexSafe(label)}} = \\frac{\\text{習得項目}}{${Math.max(1, denominator)}} \\times 100`;

const buildTimelineBlock = (ideas: string[]) => ({
  type: "timeline" as const,
  title: "理解のステップ",
  events: (ideas.length ? ideas : ["導入"])
    .slice(0, 5)
    .map((idea, index) => ({
      label: `ステップ${index + 1}`,
      description: condenseIdea(idea, 120),
      date: `T+${index + 1}`,
    })),
});

const buildStructuredDataBlock = (title: string, data: Record<string, unknown>): RichContentBlock => ({
  type: "structured_data",
  title,
  format: "json",
  data: data as StructuredValue,
});

const buildContentForType = (
  type: GeneratedContent["type"],
  ideas: string[],
  baseText: string,
  preset?: PresetContext,
): RichContentDocument => {
  const sourceTitle = (preset?.title ?? "学習対象").replace(/\s+/g, " ");
  const presetHint = preset?.userTemplate
    ? preset.userTemplate.replace(/\{\{.*?\}\}/g, "").slice(0, 120)
    : undefined;

  if (type === "qa") {
    const pairs = ideas.map((idea, index) => ({
      question: `Q${index + 1}: ${summarizeText(idea, 72)} は何を意味しますか？`,
      answer: idea,
      rationale: presetHint ?? `教材から抽出: ${summarizeText(idea, 120)}`,
    }));
    return {
      title: `${sourceTitle} 一問一答`,
      preview: pairs[0]?.question ?? "教材の要点からQ&Aを生成しました。",
      description: "教材の要点を即答できるようQ&Aへ落とし込みました。",
      sections: [
        {
          title: "質問と回答一覧",
          description: "左列で問い、右列で即答・根拠を整理しています。",
          blocks: [
            {
              type: "table",
              caption: "一問一答リスト",
              headers: ["質問", "回答", "根拠"],
              rows: pairs.map((pair) => [pair.question, pair.answer, pair.rationale ?? "教材参照"]),
            },
          ],
        },
        {
          title: "暗記カード",
          blocks: [
            {
              type: "list",
              ordered: false,
              items: pairs.map((pair) => ({
                title: pair.question,
                body: pair.answer,
              })),
            },
          ],
        },
        {
          title: "概念マップ",
          blocks: [buildConceptDiagram(pairs.map((pair) => pair.answer), "テーマの関連図")],
        },
      ],
      blocks: [
        {
          type: "math",
          latex: buildScoreFormula("暗記スコア", pairs.length),
          displayMode: true,
        },
      ],
      metadata: { qaPairs: pairs },
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
      description: "演習と採点のヒントを同じカード内で参照できます。",
      sections: [
        {
          title: "演習セット",
          description: "ヒント付きの穴埋め・短答を順番に解きます。",
          blocks: [
            {
              type: "list",
              ordered: true,
              items: items.map((item) => ({
                title: item.prompt,
                body: item.hint,
              })),
            },
            {
              type: "table",
              caption: "模範解答",
              headers: ["設問", "模範解答", "解説"],
              rows: items.map((item, index) => [
                `Q${index + 1}`,
                item.expectedAnswer,
                item.explanation,
              ]),
            },
          ],
        },
        {
          title: "理解のステップ",
          blocks: [buildTimelineBlock(items.map((item) => item.expectedAnswer))],
        },
      ],
      blocks: [
        {
          type: "math",
          latex: buildScoreFormula("採点基準", items.length),
          displayMode: true,
        },
        buildStructuredDataBlock("問題メタデータ", {
          問題数: items.length,
          参考教材: sourceTitle,
          使用プリセット: preset?.title ?? "デフォルト",
        }),
      ],
      metadata: { practiceItems: items },
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
      description: "台本テキストに加えて話者の流れをタイムライン化しました。",
      sections: [
        {
          title: "スクリプト",
          blocks: [
            {
              type: "list",
              ordered: false,
              items: segments.map((segment) => ({
                title: `${segment.speaker}`,
                body: segment.text,
              })),
            },
          ],
        },
        {
          title: "進行図",
          blocks: [buildConceptDiagram(segments.map((segment) => segment.text), "会話の流れ")],
        },
      ],
      blocks: [
        buildStructuredDataBlock("収録メモ", {
          セグメント数: segments.length,
          主要話者: segments
            .map((segment) => segment.speaker)
            .filter((value, index, arr) => arr.indexOf(value) === index),
        }),
      ],
      metadata: { podcastSegments: segments },
    };
  }

  if (type === "other") {
    const highlights = (ideas.length ? ideas : [summarizeText(baseText, 180)]).slice(0, 5);
    return {
      title: `${sourceTitle} リッチノート`,
      preview: summarizeText(highlights[0] ?? baseText, 60),
      description: presetHint ?? "図形・数式・表を含むリッチノートの雛形です。",
      sections: [
        {
          title: "キーポイント",
          description: "主要概念の抜粋とメモ",
          blocks: [
            {
              type: "list",
              ordered: false,
              items: highlights.map((idea, index) => ({
                title: `ポイント${index + 1}`,
                body: condenseIdea(idea, 160),
                math: index === 0 ? buildScoreFormula("理解度", highlights.length) : undefined,
              })),
            },
            {
              type: "table",
              caption: "要点サマリ",
              headers: ["#", "概要"],
              rows: highlights.map((idea, index) => [`${index + 1}`, summarizeText(idea, 80)]),
            },
          ],
        },
        {
          title: "構造化ビュー",
          description: "概念間のつながりと学びの順序を図示",
          blocks: [
            buildConceptDiagram(highlights, "関連図"),
            buildTimelineBlock(highlights),
          ],
        },
        {
          title: "メタデータ",
          description: "設定や抽出情報を構造化して記録",
          blocks: [
            buildStructuredDataBlock("生成メモ", {
              ハイライト数: highlights.length,
              使用プリセット: preset?.title ?? "デフォルト",
              抜粋元: sourceTitle,
            }),
          ],
        },
      ],
      blocks: [
        {
          type: "math",
          latex: buildScoreFormula("復習優先度", highlights.length),
          displayMode: true,
        },
      ],
      metadata: { highlights },
    };
  }

  if (type === "summary") {
    const bullets = ideas.map((idea) => summarizeText(idea, 120));
    return {
      title: `${sourceTitle} 要約`,
      preview: bullets.join(" / ").slice(0, 140),
      description: summarizeText(baseText, 200),
      sections: [
        {
          title: "ポイント",
          blocks: [
            {
              type: "list",
              ordered: false,
              items: bullets.map((bullet) => ({
                title: bullet,
              })),
            },
          ],
        },
        {
          title: "理解の流れ",
          blocks: [buildTimelineBlock(ideas)],
        },
      ],
      blocks: [
        buildStructuredDataBlock("要約メタ", {
          主要トピック数: bullets.length,
          抽出元: sourceTitle,
        }),
      ],
      metadata: { summaryBullets: bullets },
    };
  }

  return {
    title: `${sourceTitle} 生成コンテンツ`,
    preview: summarizeText(baseText, 80),
    description: "単純なテキストプレビューです。",
    sections: [
      {
        title: "プレビュー",
        blocks: [
          {
            type: "text",
            variant: "paragraph",
            text: summarizeText(baseText, 320),
          },
        ],
      },
    ],
    blocks: [],
  };
};

const MATERIAL_CONTEXT_CHAR_LIMIT = 10_000;
const DEFAULT_GENERATION_TEMPERATURE = 0.35;

interface GenerationGuide {
  label: string;
  objective: string;
  instructions: string;
  schema: string;
  temperature?: number;
  maxTokens?: number;
}

const generationTypeGuides: Record<GeneratedContent["type"], GenerationGuide> = {
  qa: {
    label: "一問一答",
    objective: "教材の核心トピックから5問の短い質問と回答を抽出する",
    instructions: [
      "- pairs は教材の重要概念を問う 5 件以上の一問一答で構成する",
      "- question は高校生にも分かる日本語の問いかけ文にする",
      "- answer は2文以内で根拠を明示し、教材内の語句を引用する",
      "- rationale には答えの導出過程や参照箇所（節・キーワード）を簡潔に書く",
    ].join("\n"),
    schema: `{
  "title": "string",
  "preview": "string (最初の質問の要約。全角40文字以内)",
  "pairs": [
    {
      "question": "string",
      "answer": "string",
      "rationale": "string"
    }
  ]
}`,
    temperature: 0.35,
    maxTokens: 900,
  },
  practice: {
    label: "練習問題",
    objective: "短答・記述混在の演習問題を3〜5問作成する",
    instructions: [
      "- items には 3〜5 問の演習問題を含める",
      "- prompt は問題文、expectedAnswer は模範解答、hint は思考のヒントを1文で書く",
      "- explanation には採点時に伝えるべき要点や誤りがちな点を書く",
      "- 記述式の問いを最低1問含め、得点差が付く要素を説明する",
    ].join("\n"),
    schema: `{
  "title": "string",
  "preview": "string (代表問題の要約)",
  "items": [
    {
      "prompt": "string",
      "expectedAnswer": "string",
      "hint": "string",
      "explanation": "string"
    }
  ]
}`,
    temperature: 0.35,
    maxTokens: 1100,
  },
  summary: {
    label: "要約",
    objective: "教材の要点を3〜5個の箇条書きと短い概要文に整理する",
    instructions: [
      "- bullets には教材のキーメッセージを 3〜5 件含める",
      "- summary は 3〜4 文で全体像→重要概念→次に学ぶべき内容の順に書く",
      "- 可能なら数式や年号など具体的な値を一つ以上含める",
    ].join("\n"),
    schema: `{
  "title": "string",
  "preview": "string (bullet の先頭要約)",
  "bullets": ["string"],
  "summary": "string"
}`,
    temperature: 0.25,
    maxTokens: 700,
  },
  podcast_script: {
    label: "ポッドキャスト用スクリプト",
    objective: "講師と生徒（もしくは2名の出演者）が交互に解説する台本を用意する",
    instructions: [
      "- segments は 6〜8 個の会話セクションで構成し、speaker には登場人物名を入れる",
      "- text は1セグメントあたり2〜3文程度で、例え話や質問を交える",
      "- 概念導入→掘り下げ→まとめ の流れになるよう配置する",
    ].join("\n"),
    schema: `{
  "title": "string",
  "preview": "string (冒頭セグメントの抜粋)",
  "segments": [
    {
      "speaker": "string",
      "text": "string"
    }
  ]
}`,
    temperature: 0.55,
    maxTokens: 1200,
  },
  other: {
    label: "リッチノート",
    objective: "図解・数式・表を交えた構造化ノートをまとめる",
    instructions: [
      "- sections を 2〜4 件用意し、text/math/table/list/timeline/diagram/structured_data を組み合わせてブロックを作る",
      "- math は LaTeX で正規化し、diagram は 3〜6 ノード・簡素なラベルで構造を示す",
      "- table は 3〜6 行・3 列以内で主要な比較や手順を示す。timeline には時系列のラベルと説明を入れる",
      "- structured_data には主要パラメータ・値を JSON でまとめ、前段のブロックの要約として使う",
      "- 事実が足りない場合は不足を明示し、確かな情報のみ書く。出力内の文章はすべて日本語にする",
    ].join("\n"),
    schema: `{
  "title": "string",
  "preview": "string (先頭セクションの要約。全角40文字以内)",
  "description": "string (全体の狙いを1〜2文)",
  "sections": [{
    "title": "string",
    "description": "string",
    "blocks": [
      { "type": "text", "text": "string", "variant": "heading|paragraph|quote|code", "badge": "string" },
      { "type": "math", "latex": "string", "displayMode": true },
      { "type": "table", "caption": "string", "headers": ["string"], "rows": [["string|number|boolean|null"]] },
      { "type": "list", "title": "string", "ordered": false, "items": ["string" | { "title": "string", "body": "string", "math": "string" }] },
      { "type": "timeline", "title": "string", "events": [{ "label": "string", "description": "string", "date": "string" }] },
      { "type": "diagram", "title": "string", "description": "string", "layout": "horizontal|vertical", "nodes": [{ "id": "string", "label": "string", "description": "string" }], "edges": [{ "from": "string", "to": "string", "label": "string" }] },
      { "type": "structured_data", "title": "string", "format": "key_value|json|metrics", "data": { "key": "value" } }
    ]
  }],
  "blocks": []
}`,
    temperature: 0.3,
    maxTokens: 1400,
  },
};

const baseGenerationSystemPrompt =
  "You are TheTeacher, an assistant that writes Japanese learning assets from source material. Always follow the requested JSON schema, keep answers factual, and stay concise.";

const stripJsonFence = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith("```")) {
    const withoutFence = trimmed.replace(/^```[a-z]*\s*/i, "").replace(/```$/, "");
    return withoutFence.trim();
  }
  return trimmed;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

const ensureString = (value: unknown, fallback = "") => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return fallback;
};

const ensureStringArray = (value: unknown, fallback: string[], limit: number) => {
  if (!Array.isArray(value)) return fallback;
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (trimmed.length > 0) {
        items.push(trimmed);
        if (items.length >= limit) break;
      }
    }
  }
  return items.length ? items : fallback;
};

const pickField = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    if (key in record) {
      const value = record[key];
      if (value !== undefined && value !== null) {
        return value;
      }
    }
  }
  return undefined;
};

const mapRecordArray = <T>(
  value: unknown,
  limit: number,
  transform: (record: Record<string, unknown>, index: number) => T | null,
): T[] => {
  if (!Array.isArray(value)) return [];
  const items: T[] = [];
  value.some((entry, index) => {
    const record = asRecord(entry);
    if (!record) return false;
    const mapped = transform(record, index);
    if (mapped) {
      items.push(mapped);
      if (items.length >= limit) {
        return true;
      }
    }
    return false;
  });
  return items;
};

const parseAssistantJson = (raw: string) => {
  const normalized = stripJsonFence(raw);
  const tryParse = (text: string) => {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("response was not a JSON object");
    }
    return parsed as Record<string, unknown>;
  };

  try {
    return tryParse(normalized);
  } catch {
    const start = normalized.indexOf("{");
    const end = normalized.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return tryParse(normalized.slice(start, end + 1));
    }
    throw new ToolCallError("generation_parse_failed", "Failed to parse AI response as JSON");
  }
};

const applyMaterialTemplate = (
  template: string | undefined,
  context: string,
  guide: GenerationGuide,
) => {
  if (!template) return undefined;
  const replacements: Record<string, string> = {
    material: context,
    content: context,
    type: guide.label,
    objective: guide.objective,
  };
  let rendered = template;
  Object.entries(replacements).forEach(([key, value]) => {
    rendered = rendered.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "gi"), value);
  });
  if (rendered === template) {
    return `${template.trim()}\n\n${context}`;
  }
  return rendered;
};

const buildMaterialContext = (
  learning: Learning,
  material: Material,
  materialText: string,
  ideas: string[],
) => {
  const metadata = material.metadata ?? {};
  const nameCandidates = [
    typeof metadata?.name === "string" ? metadata.name : undefined,
    typeof metadata?.displayName === "string" ? metadata.displayName : undefined,
    typeof metadata?.payloadFileName === "string" ? metadata.payloadFileName : undefined,
  ].filter((value): value is string => Boolean(value && value.trim()));

  const keyPoints = ideas.length ? ideas.map((idea, index) => `- (${index + 1}) ${idea}`) : [];
  const truncatedText = materialText.slice(0, MATERIAL_CONTEXT_CHAR_LIMIT).trim();
  const truncatedNotice =
    materialText.length > truncatedText.length
      ? `\n\n[Note] 原文 ${materialText.length} 文字のうち ${MATERIAL_CONTEXT_CHAR_LIMIT} 文字までを使用`
      : "";

  const lines = [
    `Learning Title: ${learning.title}`,
    learning.subject ? `Subject: ${learning.subject}` : null,
    learning.tags?.length ? `Tags: ${learning.tags.join(", ")}` : null,
    `Material Type: ${material.type}`,
    nameCandidates[0] ? `Material Name: ${nameCandidates[0]}` : null,
    material.sourcePath ? `Source Path: ${material.sourcePath}` : null,
    `Extracted Characters: ${materialText.length}`,
  ].filter(Boolean);

  return (
    `${lines.join("\n")}\n\n# Key Points\n${
      keyPoints.length ? keyPoints.join("\n") : "- キーポイントを抽出できませんでした"
    }\n\n# Material Text\n"""${truncatedText || "教材本文が空です"}"""${truncatedNotice}`
  );
};

const buildUserPromptForType = (
  templatePrompt: string | undefined,
  context: string,
  guide: GenerationGuide,
) => {
  const baseInstruction =
    templatePrompt ?? `次の教材から ${guide.objective}。\n\n${context}`;
  return [
    baseInstruction.trim(),
    "",
    "# Output Requirements",
    guide.instructions,
    "",
    "# JSON Schema",
    guide.schema,
    "",
    "制約:",
    "- 出力は上記スキーマ通りの単一JSONオブジェクト",
    "- 文章はすべて日本語で書く",
    "- 教材に含まれない情報を推測で補わない",
  ].join("\n");
};

const ensureOpenAiGenerationConfig = (env?: AppBindings) => {
  const apiKey = env?.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new ToolCallError("openai_not_configured", "OPENAI_API_KEY is not configured", 503);
  }
  const model = env?.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  return { apiKey, model };
};

const callOpenAiForGeneration = async (
  env: AppBindings | undefined,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options?: { temperature?: number; maxTokens?: number },
) => {
  const { apiKey, model } = ensureOpenAiGenerationConfig(env);
  const response = await fetch(`${resolveOpenAiBaseUrl(env)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: options?.temperature ?? DEFAULT_GENERATION_TEMPERATURE,
      max_tokens: options?.maxTokens ?? 1100,
      response_format: { type: "json_object" },
      messages,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new ToolCallError(
      "generation_failed",
      `OpenAI request failed (${response.status}): ${detail}`,
      response.status as ContentfulStatusCode,
    );
  }
  const json = await response.json() as { 
    choices?: { message?: { content?: unknown } }[]; 
    model?: string; 
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  };
  const content = joinChatContent(json.choices?.[0]?.message?.content);
  if (!content) {
    throw new ToolCallError("generation_failed", "OpenAI response did not contain any content", 502);
  }
  const usage = json.usage
    ? {
        promptTokens: json.usage.prompt_tokens as number | undefined,
        completionTokens: json.usage.completion_tokens as number | undefined,
        totalTokens: json.usage.total_tokens as number | undefined,
      }
    : undefined;
  return {
    text: content,
    model: (json.model as string | undefined) ?? model,
    usage,
  };
};

const pickRichContentDocument = (...candidates: unknown[]): RichContentDocument | null => {
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const parsed = richContentDocumentSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
    const record = candidate as Record<string, unknown>;
    const nested =
      record.document ?? record.richDocument ?? record.rich_content ?? record.richContent;
    if (nested) {
      const nestedParsed = richContentDocumentSchema.safeParse(nested);
      if (nestedParsed.success) return nestedParsed.data;
    }
  }
  return null;
};

const normalizeGeneratedPayload = (
  type: GeneratedContent["type"],
  parsed: Record<string, unknown>,
  fallback: Record<string, unknown>,
) => {
  const fallbackTitle = ensureString(fallback.title);
  const fallbackPreview = ensureString(fallback.preview);

  if (type === "other") {
    const parsedRichDocument = pickRichContentDocument(
      parsed,
      (parsed as { document?: unknown }).document,
    );
    const fallbackRichDocument = pickRichContentDocument(fallback);
    if (parsedRichDocument) {
      return {
        ...parsedRichDocument,
        title: ensureString(parsedRichDocument.title, fallbackTitle || "リッチノート"),
        preview: ensureString(
          parsedRichDocument.preview,
          fallbackPreview || parsedRichDocument.description || parsedRichDocument.title || "",
        ),
      };
    }

    const sectionsCandidate =
      pickField(parsed, ["sections", "blocks", "items"]) ?? pickField(parsed, ["data"]);
    const sections = mapRecordArray(sectionsCandidate, 6, (record) => {
      const title = ensureString(pickField(record, ["title", "heading", "label"]));
      const description = ensureString(
        pickField(record, ["description", "body", "text", "summary"]),
      );
      const math = ensureString(pickField(record, ["latex", "math", "formula"]));
      const blocks: RichContentBlock[] = [];
      if (title) {
        blocks.push({ type: "text", text: title, variant: "heading" });
      }
      if (description) {
        blocks.push({ type: "text", text: description, variant: "paragraph" });
      }
      if (math) {
        blocks.push({ type: "math", latex: math, displayMode: true });
      }
      if (!blocks.length) return null;
      return {
        title: title || undefined,
        description: description || undefined,
        blocks,
      };
    });
    const body = ensureString(
      pickField(parsed, ["body", "text", "summary", "notes", "description"]),
      fallbackPreview,
    );
    return {
      title: ensureString(parsed.title, fallbackTitle || "リッチノート"),
      preview: ensureString(parsed.preview, fallbackPreview || body || sections[0]?.description || ""),
      description: body || undefined,
      sections: sections.length ? sections : fallbackRichDocument?.sections ?? [],
      blocks: sections.length || !body
        ? fallbackRichDocument?.blocks ?? []
        : [{ type: "text", text: body, variant: "paragraph" }],
      metadata: fallbackRichDocument?.metadata,
    };
  }

  if (type === "qa") {
    const fallbackPairs = Array.isArray((fallback as { pairs?: unknown }).pairs)
      ? ((fallback as { pairs?: { question: string; answer: string; rationale?: string }[] }).pairs ??
        [])
      : [];
    const pairsCandidate =
      pickField(parsed, ["pairs", "questions", "items", "qa"]) ??
      pickField(parsed, ["data"]);
    const pairs = mapRecordArray(pairsCandidate, 12, (record) => {
      const question = ensureString(pickField(record, ["question", "prompt", "q"]));
      const answer = ensureString(pickField(record, ["answer", "response", "a", "solution"]));
      if (!question || !answer) return null;
      const rationale = ensureString(
        pickField(record, ["rationale", "reason", "explanation", "note"]),
      );
      return rationale ? { question, answer, rationale } : { question, answer };
    });
    return {
      title: ensureString(parsed.title, fallbackTitle || "一問一答"),
      preview: ensureString(
        parsed.preview,
        fallbackPreview || pairs[0]?.question || fallbackPairs[0]?.question || "",
      ),
      pairs: pairs.length ? pairs : fallbackPairs,
    };
  }

  if (type === "practice") {
    const fallbackItems = Array.isArray((fallback as { items?: unknown }).items)
      ? ((fallback as { items?: Record<string, unknown>[] }).items ?? [])
      : [];
    const itemsCandidate =
      pickField(parsed, ["items", "problems", "questions"]) ??
      pickField(parsed, ["data"]);
    const items = mapRecordArray(itemsCandidate, 10, (record) => {
      const prompt = ensureString(pickField(record, ["prompt", "question", "problem"]));
      const expectedAnswer = ensureString(
        pickField(record, ["expectedAnswer", "answer", "solution", "response"]),
      );
      if (!prompt || !expectedAnswer) return null;
      const hint = ensureString(pickField(record, ["hint", "clue"]));
      const explanation = ensureString(
        pickField(record, ["explanation", "rationale", "analysis", "feedback"]),
      );
      return { prompt, expectedAnswer, hint, explanation };
    });
    const representative = items[0] ?? fallbackItems[0];
    return {
      title: ensureString(parsed.title, fallbackTitle || "練習問題"),
      preview: ensureString(
        parsed.preview,
        fallbackPreview || representative?.prompt || "",
      ),
      items: items.length ? items : fallbackItems,
    };
  }

  if (type === "summary") {
    const fallbackBullets = Array.isArray((fallback as { bullets?: unknown }).bullets)
      ? ((fallback as { bullets?: string[] }).bullets ?? [])
      : [];
    const fallbackSummary = ensureString((fallback as { summary?: unknown }).summary);
    const bulletCandidate =
      pickField(parsed, ["bullets", "highlights", "keyPoints"]) ??
      pickField(parsed, ["items"]);
    const bullets = ensureStringArray(bulletCandidate, fallbackBullets, 6);
    const summaryText = ensureString(
      pickField(parsed, ["summary", "body", "text"]),
      fallbackSummary || bullets.join(" / "),
    );
    return {
      title: ensureString(parsed.title, fallbackTitle || "要約"),
      preview: ensureString(parsed.preview, fallbackPreview || bullets[0] || summaryText),
      bullets,
      summary: summaryText,
    };
  }

  if (type === "podcast_script") {
    const fallbackSegments = Array.isArray((fallback as { segments?: unknown }).segments)
      ? ((fallback as { segments?: { speaker: string; text: string }[] }).segments ?? [])
      : [];
    const segmentsCandidate =
      pickField(parsed, ["segments", "script", "lines", "dialogue", "scriptSections"]) ??
      pickField(parsed, ["items"]);
    const segments = mapRecordArray(segmentsCandidate, 12, (record, index) => {
      const speaker = ensureString(
        pickField(record, ["speaker", "role", "character", "persona"]),
        index % 2 === 0 ? "講師" : "生徒",
      );
      const text = ensureString(pickField(record, ["text", "line", "utterance", "dialogue"]));
      if (!text) return null;
      return { speaker, text };
    });
    return {
      title: ensureString(parsed.title, fallbackTitle || "ポッドキャストスクリプト"),
      preview: ensureString(parsed.preview, fallbackPreview || segments[0]?.text || ""),
      segments: segments.length ? segments : fallbackSegments,
    };
  }

  const fallbackSections = Array.isArray((fallback as { sections?: unknown }).sections)
    ? ((fallback as { sections?: { title?: string; body?: string }[] }).sections ?? [])
    : [];
  const sectionsCandidate =
    pickField(parsed, ["sections", "chapters", "blocks"]) ?? pickField(parsed, ["items"]);
  const sections = mapRecordArray(sectionsCandidate, 10, (record) => {
    const title = ensureString(pickField(record, ["title", "heading", "label"]));
    const body = ensureString(pickField(record, ["body", "text", "description", "summary"]));
    if (!title && !body) return null;
    return title ? { title, body } : { body };
  });
  const body = ensureString(
    pickField(parsed, ["body", "text", "summary", "notes"]),
    ensureString((fallback as { body?: unknown }).body, fallbackPreview),
  );
  return {
    title: ensureString(parsed.title, fallbackTitle || "生成コンテンツ"),
    preview: ensureString(parsed.preview, fallbackPreview || body.slice(0, 60)),
    body,
    sections: sections.length ? sections : fallbackSections,
  };
};

const generateContentsFromMaterial = async (
  env: AppBindings | undefined,
  request: GenerateFromMaterialRequest,
  learning: Learning,
  material: Material,
  preset?: PresetContext,
) => {
  const materialText = material.rawContent?.trim();
  if (!materialText) {
    throw new ToolCallError(
      "material_empty",
      "This material does not contain extracted text. Please ingest or upload content first.",
      400,
    );
  }
  // eslint-disable-next-line no-control-regex
  const sanitized = materialText.replace(/\u0000/g, "");
  const ideas = splitIdeas(sanitized, 8);
  const context = buildMaterialContext(learning, material, sanitized, ideas);
  const promptPreset =
    preset?.title ??
    request.presetTitle ??
    request.presetUserTemplate ??
    request.presetId;

  const drafts: Omit<GeneratedContent, "id" | "createdAt">[] = [];
  let totalTokens = 0;
  let modelName: string | undefined;
  const systemMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: baseGenerationSystemPrompt },
  ];
  if (preset?.systemPrompt) {
    systemMessages.push({ role: "system", content: preset.systemPrompt });
  }

  for (const type of request.types) {
    const guide = generationTypeGuides[type] ?? generationTypeGuides.other;
    const templatePrompt = applyMaterialTemplate(preset?.userTemplate, context, guide);
    const userPrompt = buildUserPromptForType(templatePrompt, context, guide);
    const fallbackContent = buildContentForType(type, ideas, sanitized, preset) as Record<
      string,
      unknown
    >;
    const { text, model, usage } = await callOpenAiForGeneration(
      env,
      [...systemMessages, { role: "user", content: userPrompt }],
      { temperature: guide.temperature, maxTokens: guide.maxTokens },
    );
    const parsed = parseAssistantJson(text);
    const normalized = normalizeGeneratedPayload(type, parsed, fallbackContent);
    drafts.push({
      learningId: request.learningId,
      materialId: material.id,
      type,
      promptPreset: promptPreset ?? undefined,
      content: normalized,
    });
    modelName = model ?? modelName;
    if (usage?.totalTokens) {
      totalTokens += usage.totalTokens;
    }
  }

  return {
    drafts,
    meta: {
      modelName,
      tokens: totalTokens,
    },
  };
};

const fetchLearning = async (db: D1Database, id: string, userId: string = DEFAULT_USER_ID) => {
  const prisma = getPrismaClient(db);
  const learning = await prisma.learning.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          materials: true,
          generatedContents: true,
          practiceSessions: true,
        },
      },
      practiceSessions: {
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  if (!learning || learning.userId !== userId) return null;
  const lastStudied = learning.practiceSessions[0]?.createdAt;
  return mapLearning({
    ...learning,
    tags: learning.tags as unknown as string,
    materialsCount: learning._count.materials,
    generatedCount: learning._count.generatedContents,
    sessionCount: learning._count.practiceSessions,
    lastStudiedAt:
      lastStudied === null || lastStudied === undefined
        ? undefined
        : typeof lastStudied === "string"
          ? lastStudied
          : lastStudied.toISOString(),
  } as unknown as LearningWithStatsRow);
};

const listLearnings = async (
  db: D1Database,
  params: z.infer<typeof learningListQuerySchema>,
  userId: string,
) => {
  const prisma = getPrismaClient(db);
  const where: Prisma.LearningWhereInput = {
    userId,
    ...(params.subject ? { subject: params.subject } : {}),
  };
  if (params.q) {
    where.OR = [
      { title: { contains: params.q, mode: "insensitive" } },
      { subject: { contains: params.q, mode: "insensitive" } },
    ];
  }
  const learnings = await prisma.learning.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: params.limit,
    include: {
      _count: {
        select: { materials: true, generatedContents: true, practiceSessions: true },
      },
      practiceSessions: {
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  const filtered = params.tag
    ? learnings.filter((learning) => {
        const tags = learning.tags;
        if (!tags) return false;
        if (Array.isArray(tags)) {
          return tags.some((tag) =>
            typeof tag === "string"
              ? tag.toLowerCase().includes(params.tag!.toLowerCase())
              : false,
          );
        }
        if (typeof tags === "string") {
          return tags.toLowerCase().includes(params.tag.toLowerCase());
        }
        return false;
      })
    : learnings;
  return filtered.map((learning) =>
    mapLearning({
      ...learning,
      tags: learning.tags as unknown as string,
      materialsCount: learning._count.materials,
      generatedCount: learning._count.generatedContents,
      sessionCount: learning._count.practiceSessions,
      lastStudiedAt:
        learning.practiceSessions[0]?.createdAt && typeof learning.practiceSessions[0]?.createdAt !== "string"
          ? learning.practiceSessions[0]!.createdAt!.toISOString()
          : learning.practiceSessions[0]?.createdAt,
    } as unknown as LearningWithStatsRow),
  );
};

const fetchPreset = async (db: D1Database, id: string, userId: string = DEFAULT_USER_ID) => {
  const prisma = getPrismaClient(db);
  const row = await prisma.preset.findUnique({ where: { id } });
  if (!row || row.userId !== userId) return null;
  return mapPreset(row as unknown as PresetRow);
};

const resolvePresetContext = async (
  db: D1Database,
  request: GenerateFromMaterialRequest,
  userId: string = DEFAULT_USER_ID,
): Promise<PresetContext | undefined> => {
  if (request.presetId) {
    const preset = await fetchPreset(db, request.presetId, userId);
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
  other: "リッチノート",
};

const SEMANTIC_NODE_LIMIT = 600;

const encodeEmbedding = (vector: number[]): Uint8Array => {
  const rounded = vector.map((value) => Number(value.toFixed(6)));
  const view = new Float32Array(rounded);
  return new Uint8Array(view.buffer.slice(0));
};

const decodeEmbeddingValue = (raw: unknown): number[] | undefined => {
  if (!raw) return undefined;
  if (Array.isArray(raw)) {
    return raw.map((value) => Number(value) || 0);
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((value) => Number(value) || 0);
      }
    } catch {
      return undefined;
    }
  }
  if (raw instanceof ArrayBuffer) {
    return Array.from(new Float32Array(raw));
  }
  if (ArrayBuffer.isView(raw as ArrayBufferView)) {
    const view = raw as ArrayBufferView;
    return Array.from(
      new Float32Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)),
    );
  }
  return undefined;
};

interface SemanticNodeDraft {
  id?: string;
  userId: string;
  refType: SemanticNode["refType"];
  refId: string;
  embedding: number[];
  label: string;
  excerpt: string;
  subject?: string;
  metadata?: Record<string, unknown>;
}

type SemanticNodeDraftInput = Omit<SemanticNodeDraft, "embedding"> & { embeddingText: string };

const semanticNodeId = (refType: SemanticNode["refType"], refId: string) =>
  `${refType}:${refId}`;

const toSemanticNodeWithMeta = (
  draft: SemanticNodeDraft,
): SemanticNodeWithMeta & { embedding: number[] } => ({
  id: draft.id ?? semanticNodeId(draft.refType, draft.refId),
  userId: draft.userId,
  refType: draft.refType,
  refId: draft.refId,
  embedding: draft.embedding,
  metadata: draft.metadata,
  label: draft.label,
  excerpt: draft.excerpt,
  subject: draft.subject,
});

const attachEmbeddingsToSemanticDrafts = async (
  drafts: SemanticNodeDraftInput[],
  env?: AppBindings,
): Promise<SemanticNodeDraft[]> => {
  if (drafts.length === 0) return [];
  const { embeddings, dimension } = await generateEmbeddings(
    drafts.map((draft) => draft.embeddingText),
    env,
  );
  return drafts.map((draft, index) => ({
    id: draft.id,
    userId: draft.userId,
    refType: draft.refType,
    refId: draft.refId,
    embedding: embeddings[index] ?? toEmbedding(draft.embeddingText, dimension),
    label: draft.label,
    excerpt: draft.excerpt,
    subject: draft.subject,
    metadata: draft.metadata,
  }));
};

const persistSemanticNode = async (
  db: D1Database | undefined,
  draft: SemanticNodeDraft,
) => {
  if (!db) return;
  const id = draft.id ?? semanticNodeId(draft.refType, draft.refId);
  await ensureCoreTables(db);
  const prisma = getPrismaClient(db);
  const metadata = {
    ...(draft.metadata ?? {}),
    label: draft.label,
    excerpt: draft.excerpt,
    subject: draft.subject ?? null,
  };
  await prisma.semanticNode.upsert({
    where: { id },
    create: {
      id,
      userId: draft.userId,
      refType: draft.refType,
      refId: draft.refId,
      embedding: encodeEmbedding(draft.embedding),
      metadata: metadata as unknown as Prisma.JsonValue,
    },
    update: {
      userId: draft.userId,
      refType: draft.refType,
      refId: draft.refId,
      embedding: encodeEmbedding(draft.embedding),
      metadata: metadata as unknown as Prisma.JsonValue,
    },
  });
};

const persistSemanticNodes = async (db: D1Database | undefined, drafts: SemanticNodeDraft[]) => {
  if (!db || drafts.length === 0) return;
  for (const draft of drafts) {
    await persistSemanticNode(db, draft);
  }
};

const deleteSemanticNodesByRef = async (
  db: D1Database | undefined,
  refType: SemanticNode["refType"],
  refIds: string[],
  userId?: string,
) => {
  if (!db || refIds.length === 0) return;
  const uniqueIds = Array.from(new Set(refIds));
  await ensureCoreTables(db);
  const prisma = getPrismaClient(db);
  await prisma.semanticNode.deleteMany({
    where: {
      refType,
      refId: { in: uniqueIds },
      ...(userId ? { userId } : {}),
    },
  });
};

const FALLBACK_EMBEDDING_DIMENSION = 12;
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

type EmbeddingProvider = "openai" | "fallback";

interface EmbeddingBatchResult {
  embeddings: number[][];
  dimension: number;
  model?: string;
  provider: EmbeddingProvider;
}

const toEmbedding = (text: string, dimension = FALLBACK_EMBEDDING_DIMENSION): number[] => {
  const vec = Array.from({ length: dimension }, () => 0);
  for (let i = 0; i < text.length; i++) {
    const bucket = i % dimension;
    vec[bucket] += text.charCodeAt(i) % 31;
  }
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value ** 2, 0)) || 1;
  return vec.map((value) => Number((value / norm).toFixed(4)));
};

const normalizeEmbeddingVector = (vector: unknown): number[] => {
  if (!Array.isArray(vector)) return [];
  return vector.map((value) => Number(value) || 0);
};

const generateEmbeddings = async (
  texts: string[],
  env?: AppBindings,
): Promise<EmbeddingBatchResult> => {
  if (texts.length === 0) {
    return { embeddings: [], dimension: FALLBACK_EMBEDDING_DIMENSION, provider: "fallback" };
  }

  const apiKey = env?.OPENAI_API_KEY?.trim();
  const model =
    env?.OPENAI_EMBED_MODEL?.trim() ||
    env?.OPENAI_EMBEDDING_MODEL?.trim() ||
    DEFAULT_EMBEDDING_MODEL;
  if (!apiKey) {
    return {
      embeddings: texts.map((text) => toEmbedding(text)),
      dimension: FALLBACK_EMBEDDING_DIMENSION,
      provider: "fallback",
    };
  }

  try {
    const response = await fetch(`${resolveOpenAiBaseUrl(env)}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: texts,
        model,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`OpenAI embedding request failed (${response.status}): ${detail}`);
    }
    const json = (await response.json()) as { data?: { embedding?: number[] }[]; model?: string };
    const vectors = (json.data ?? []).map((item) => normalizeEmbeddingVector(item.embedding));
    if (!vectors.length || vectors.some((vec) => vec.length === 0)) {
      throw new Error("OpenAI embedding response did not contain valid vectors");
    }
    const dimension = vectors[0].length;
    return {
      embeddings: vectors,
      dimension,
      model: json.model ?? model,
      provider: "openai",
    };
  } catch (error) {
    console.warn("embedding generation failed, falling back", error);
    return {
      embeddings: texts.map((text) => toEmbedding(text)),
      dimension: FALLBACK_EMBEDDING_DIMENSION,
      provider: "fallback",
    };
  }
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

const fallbackSemanticNodes = (userId: string = DEFAULT_USER_ID): (SemanticNodeWithMeta & { embedding: number[] })[] =>
  [
    {
      id: "fallback-learning",
      userId,
      refType: "learning" as const,
      refId: "fallback-learning",
      embedding: toEmbedding("高校数学 二次関数 基礎練習"),
      metadata: { tags: ["math"] },
      label: "高校数学I: 二次関数",
      excerpt: "二次関数の基本変換と判別式を確認する練習セット",
      subject: "math",
    },
  ].map((node) => ({ ...node, embedding: node.embedding.slice() }));

const mapSemanticRowToNode = (
  row: SemanticNodeRow,
): (SemanticNodeWithMeta & { embedding: number[] }) | null => {
  const embedding = decodeEmbeddingValue(row.embedding);
  if (!embedding || embedding.length === 0) return null;
  const metadata =
    typeof row.metadata === "string"
      ? parseJson<Record<string, unknown>>(row.metadata)
      : ((row.metadata as unknown as Record<string, unknown>) ?? undefined);
  const label =
    typeof metadata?.label === "string"
      ? metadata.label
      : `${row.refType.toUpperCase()}: ${row.refId.slice(0, 8)}`;
  const excerpt = typeof metadata?.excerpt === "string" ? metadata.excerpt : label;
  const subject =
    typeof metadata?.subject === "string" && metadata.subject.length > 0
      ? metadata.subject
      : undefined;
  return {
    id: row.id,
    userId: row.userId,
    refType: row.refType,
    refId: row.refId,
    embedding,
    metadata,
    label,
    excerpt,
    subject,
  };
};

const loadSemanticNodesFromDb = async (
  db: D1Database,
  userId: string,
): Promise<(SemanticNodeWithMeta & { embedding: number[] })[]> => {
  const prisma = getPrismaClient(db);
  const rows = await prisma.semanticNode.findMany({
    where: { userId },
    orderBy: { id: "desc" },
    take: SEMANTIC_NODE_LIMIT,
  });
  return rows
    .map((row) => mapSemanticRowToNode(row as unknown as SemanticNodeRow))
    .filter((node): node is SemanticNodeWithMeta & { embedding: number[] } => Boolean(node));
};

const buildLearningEmbeddingBasis = (
  learning: Pick<Learning, "title" | "subject" | "tags">,
) => {
  const tags = learning.tags ?? [];
  const basis = `${learning.title} ${learning.subject ?? ""} ${tags.join(" ")}`.trim();
  return { basis, tags };
};

const buildLearningSemanticDraft = (
  learning: Pick<Learning, "id" | "title" | "subject" | "tags">,
): SemanticNodeDraftInput => {
  const { basis, tags } = buildLearningEmbeddingBasis(learning);
  return {
    refType: "learning",
    refId: learning.id,
    embeddingText: basis,
    label: learning.title,
    excerpt: summarizeText(basis, 120),
    subject: learning.subject ?? undefined,
    metadata: { tags },
  };
};

const buildMaterialEmbeddingBasis = (material: Material) =>
  `${material.type} ${material.rawContent ?? material.sourcePath ?? material.type ?? ""}`;

const buildMaterialSemanticDraft = (
  material: Material,
  subject?: string,
): SemanticNodeDraftInput => {
  const body = material.rawContent ?? material.sourcePath ?? material.type;
  return {
    refType: "material",
    refId: material.id,
    embeddingText: buildMaterialEmbeddingBasis(material),
    label: `${material.type.toUpperCase()}: ${summarizeText(
      material.sourcePath ?? material.rawContent ?? "material",
      48,
    )}`,
    excerpt: summarizeText(body ?? material.type, 160),
    subject,
    metadata: {
      ...(material.metadata ?? {}),
      learningId: material.learningId,
      type: material.type,
    },
  };
};

const buildGeneratedContentSemanticDraft = (
  content: GeneratedContent,
  subject?: string,
): SemanticNodeDraftInput => {
  const body = flattenContent(content.content);
  return {
    refType: "generated_content",
    refId: content.id,
    embeddingText: `${content.type} ${body}`,
    label: `${generatedLabelMap[content.type] ?? content.type}: ${summarizeText(body, 48)}`,
    excerpt: summarizeText(body, 160),
    subject,
    metadata: {
      promptPreset: content.promptPreset,
      materialId: content.materialId,
      learningId: content.learningId,
      type: content.type,
    },
  };
};

const normalizeQuestionRef = (value?: Record<string, unknown>) => {
  const record = asRecord(value);
  if (!record) return {};
  const toOptionalString = (input: unknown): string | undefined => {
    const text = ensureString(input);
    return text.length ? text : undefined;
  };
  return {
    prompt: toOptionalString(pickField(record, ["prompt", "question", "body", "text"])),
    expected: toOptionalString(
      pickField(record, ["expected", "expectedAnswer", "answer", "solution"]),
    ),
    hint: toOptionalString(pickField(record, ["hint", "explanation", "note", "rationale"])),
    title: toOptionalString(pickField(record, ["title", "name", "label"])),
    subject: toOptionalString(pickField(record, ["subject", "course"])),
  };
};

const buildPracticeQuestionSemanticDraft = (
  session: PracticeSession,
  subject?: string,
): SemanticNodeDraftInput => {
  const question = normalizeQuestionRef(session.questionRef);
  const excerptSource =
    question.prompt ?? question.expected ?? question.hint ?? session.answerText ?? "演習問題";
  const label =
    question.title ?? summarizeText(question.prompt ?? excerptSource ?? "演習問題", 48) ?? "演習問題";
  const embeddingParts = [
    label,
    question.prompt,
    question.expected,
    question.hint,
    session.answerText,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const embeddingText = embeddingParts.join(" ").trim() || "演習問題";

  return {
    refType: "question",
    refId: session.id,
    embeddingText,
    label,
    excerpt: summarizeText(excerptSource, 160),
    subject: question.subject ?? subject,
    metadata: {
      learningId: session.learningId,
      generatedContentId: session.generatedContentId,
      expected: question.expected,
      hint: question.hint,
      title: question.title,
      prompt: question.prompt,
      answerPreview: session.answerText ? summarizeText(session.answerText, 96) : undefined,
      score: session.score,
      isCorrect: session.isCorrect,
    },
  };
};

const indexLearningSemanticNode = async (
  db: D1Database | undefined,
  env: AppBindings | undefined,
  learning: Pick<Learning, "id" | "title" | "subject" | "tags" | "userId">,
) => {
  const drafts = await attachEmbeddingsToSemanticDrafts(
    [{ ...buildLearningSemanticDraft(learning), userId: learning.userId }],
    env,
  );
  if (drafts[0]) {
    await persistSemanticNode(db, drafts[0]);
  }
};

const indexMaterialSemanticNode = async (
  db: D1Database | undefined,
  env: AppBindings | undefined,
  material: Material,
  subject?: string,
) => {
  const drafts = await attachEmbeddingsToSemanticDrafts(
    [{ ...buildMaterialSemanticDraft(material, subject), userId: material.userId }],
    env,
  );
  if (drafts[0]) {
    await persistSemanticNode(db, drafts[0]);
  }
};

const indexGeneratedContentSemanticNode = async (
  db: D1Database | undefined,
  env: AppBindings | undefined,
  content: GeneratedContent,
  subject?: string,
) => {
  const drafts = await attachEmbeddingsToSemanticDrafts(
    [{ ...buildGeneratedContentSemanticDraft(content, subject), userId: content.userId }],
    env,
  );
  if (drafts[0]) {
    await persistSemanticNode(db, drafts[0]);
  }
};

const indexPracticeQuestionSemanticNode = async (
  db: D1Database | undefined,
  env: AppBindings | undefined,
  session: PracticeSession,
  subject?: string,
) => {
  const drafts = await attachEmbeddingsToSemanticDrafts(
    [{ ...buildPracticeQuestionSemanticDraft(session, subject), userId: session.userId }],
    env,
  );
  if (drafts[0]) {
    await persistSemanticNode(db, drafts[0]);
  }
};

const buildSemanticNodesFromSourceTables = async (
  db: D1Database,
  userId: string,
  env?: AppBindings,
): Promise<(SemanticNodeWithMeta & { embedding: number[] })[]> => {
  const prisma = getPrismaClient(db);
  const learningRows = await prisma.learning.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { id: true, title: true, subject: true, tags: true },
  });
  const learnings = learningRows.map((row) => ({
    id: row.id,
    title: row.title,
    subject: row.subject ?? undefined,
    tags:
      row.tags && typeof row.tags === "string"
        ? parseJson<string[]>(row.tags) ?? []
        : (row.tags as unknown as string[] | undefined) ?? [],
  }));
  const drafts: SemanticNodeDraftInput[] = learnings.map((learning) => ({
    ...buildLearningSemanticDraft(learning),
    userId,
  }));
  const learningSubjectMap = new Map(learnings.map((item) => [item.id, item.subject]));

  const materialRows = await prisma.material.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  for (const row of materialRows ?? []) {
    const material = mapMaterial(row as unknown as MaterialRow);
    drafts.push({
      ...buildMaterialSemanticDraft(material, learningSubjectMap.get(material.learningId)),
      userId,
    });
  }

  const contentRows = await prisma.generatedContent.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  for (const row of contentRows ?? []) {
    const content = mapGeneratedContent(row as unknown as GeneratedContentRow);
    drafts.push({
      ...buildGeneratedContentSemanticDraft(content, learningSubjectMap.get(content.learningId)),
      userId,
    });
  }

  const practiceRows = await prisma.practiceSession.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  for (const row of practiceRows ?? []) {
    const session = mapPracticeSession(row as unknown as PracticeSessionRow);
    drafts.push({
      ...buildPracticeQuestionSemanticDraft(
        session,
        learningSubjectMap.get(session.learningId),
      ),
      userId,
    });
  }

  const embedded = await attachEmbeddingsToSemanticDrafts(drafts, env);
  return embedded.map((draft) => toSemanticNodeWithMeta(draft));
};

const fallbackLearnings: (Learning & {
  materialsCount: number;
  generatedCount: number;
  sessionCount: number;
})[] = [
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

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value: string | undefined | null): value is string =>
  !!value && uuidPattern.test(value);

const subjectKeywordHints = [
  {
    subject: "math",
    label: "数学",
    keywords: [/数学/, /算数/, /方程式/, /関数/, /geometry/i],
  },
  {
    subject: "english",
    label: "英語",
    keywords: [/英語/, /english/i, /toeic/i, /toefl/i, /ielts/i],
  },
  {
    subject: "science",
    label: "理科",
    keywords: [/理科/, /science/i, /化学/, /physics/i, /生物/],
  },
  {
    subject: "japanese",
    label: "国語",
    keywords: [/国語/, /現代文/, /古文/, /作文/, /文章力/],
  },
  {
    subject: "social",
    label: "社会",
    keywords: [/歴史/, /地理/, /公民/, /社会/, /civics/i],
  },
  {
    subject: "programming",
    label: "プログラミング",
    keywords: [/プログラミング/, /coding/i, /アルゴリズム/, /javascript/i],
  },
] as const;

type SubjectHint = (typeof subjectKeywordHints)[number]["subject"];

const subjectLabelMap: Record<string, string> = subjectKeywordHints.reduce(
  (acc, item) => {
    acc[item.subject] = item.label;
    return acc;
  },
  {} as Record<string, string>,
);

const detectSubjectFromPrompt = (prompt: string): SubjectHint | undefined => {
  for (const hint of subjectKeywordHints) {
    if (hint.keywords.some((keyword) => keyword.test(prompt))) {
      return hint.subject;
    }
  }
  return undefined;
};

const containsKeyword = (value: string, patterns: RegExp[]) =>
  patterns.some((pattern) => pattern.test(value));

const creationKeywords = [
  /新しい学習/,
  /新規学習/,
  /教材を作/,
  /作って/,
  /作成して/,
  /生成して/,
  /build/i,
  /create/i,
  /generate/i,
];

const questionKeywords = [/問題/, /テスト/, /quiz/i, /演習/, /drill/i, /practice/i];
const qaKeywords = [/一問一答/, /qa/i, /質問集/];
const summaryKeywords = [/要約/, /まとめ/, /サマリ/, /振り返り/];
const podcastKeywords = [/ポッドキャスト/, /podcast/i, /スクリプト/];

const shouldCreateLearningFromPrompt = (prompt: string, matches: SemanticMatch[]) => {
  if (containsKeyword(prompt, creationKeywords)) {
    return true;
  }
  if (matches.length === 0) {
    return true;
  }
  const topScore = matches[0]?.score ?? 0;
  return topScore < 0.35;
};

const determineGenerationTypes = (
  prompt: string,
): GenerateFromMaterialRequest["types"] => {
  const next = new Set<GenerateFromMaterialRequest["types"][number]>();
  if (containsKeyword(prompt, questionKeywords)) next.add("practice");
  if (containsKeyword(prompt, qaKeywords)) next.add("qa");
  if (containsKeyword(prompt, summaryKeywords)) next.add("summary");
  if (containsKeyword(prompt, podcastKeywords)) next.add("podcast_script");
  return Array.from(next);
};

const buildLearningTitleFromPrompt = (prompt: string, subject?: SubjectHint) => {
  const trimmed = prompt.replace(/\s+/g, " ").trim();
  const base = trimmed.slice(0, 32) || "チャット提案プラン";
  if (!subject) return base;
  const label = subjectLabelMap[subject] ?? subject;
  return `${label}: ${base}`;
};

const buildLearningTagsFromPrompt = (prompt: string, subject?: SubjectHint) => {
  const tags = new Set<string>();
  if (subject) tags.add(subject);
  if (/toeic/i.test(prompt)) tags.add("toeic");
  if (/eiken/i.test(prompt)) tags.add("eiken");
  tags.add("ai-chat");
  return Array.from(tags);
};

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
  db: D1Database | undefined,
  env: AppBindings | undefined,
  userId: string,
): Promise<(SemanticNodeWithMeta & { embedding: number[] })[]> => {
  if (!db) return fallbackSemanticNodes(userId);
  const stored = await loadSemanticNodesFromDb(db, userId);
  if (stored.length > 0) {
    return stored;
  }
  const regenerated = await buildSemanticNodesFromSourceTables(db, userId, env);
  if (regenerated.length > 0) {
    await persistSemanticNodes(
      db,
      regenerated.map(
        (node): SemanticNodeDraft => ({
          id: node.id,
          userId: node.userId ?? userId,
          refType: node.refType,
          refId: node.refId,
          embedding: node.embedding.slice(),
          label: node.label,
          excerpt: node.excerpt,
          subject: node.subject,
          metadata: (node.metadata as Record<string, unknown> | undefined) ?? undefined,
        }),
      ),
    );
    return regenerated.map((node) => ({ ...node, userId }));
  }
  return fallbackSemanticNodes(userId);
};

const searchSemantic = async (
  db: D1Database | undefined,
  env: AppBindings | undefined,
  query: string,
  topK: number,
  filters?: Partial<Pick<SemanticNodeWithMeta, "refType" | "subject">>,
  userId: string = DEFAULT_USER_ID,
): Promise<SemanticMatch[]> => {
  const index = await buildSemanticIndex(db, env, userId);
  const { embeddings: queryEmbeddings, dimension } = await generateEmbeddings([query], env);
  const queryVector = queryEmbeddings[0] ?? toEmbedding(query, dimension);

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

type SerializedMatch = Pick<SemanticMatch, "id" | "label" | "excerpt" | "score" | "refType" | "subject">;

const serializeMatchesForClient = (matches: SemanticMatch[]): SerializedMatch[] =>
  matches.map((match) => ({
    id: match.id,
    label: match.label,
    excerpt: match.excerpt,
    score: Number(match.score ?? 0),
    refType: match.refType,
    subject: match.subject,
  }));

const describeRelatedBrief = (related: SerializedMatch[]) => {
  if (related.length === 0) return "関連候補はありませんでした。";
  return related
    .slice(0, 3)
    .map((match, index) => {
      const subjectLabel = match.subject ? subjectLabelMap[match.subject] ?? match.subject : undefined;
      const subjectText = subjectLabel ? ` / ${subjectLabel}` : "";
      return `${index + 1}. ${match.label} (score ${match.score.toFixed(2)}${subjectText})`;
    })
    .join("\n");
};

const describeToolSummary = (
  toolCalls: { tool: string; detail: string; result?: string }[],
) => {
  if (toolCalls.length === 0) return "ツールは未実行です。";
  return toolCalls
    .slice(-5)
    .map((call) => `- ${call.tool}: ${call.result ?? call.detail}`)
    .join("\n");
};

const describeGenerationSummary = (
  items: GeneratedContent[],
  plannedTypes: GenerateFromMaterialRequest["types"],
) => {
  if (items.length > 0) {
    const listed = items
      .slice(0, 3)
      .map((item) => generatedLabelMap[item.type] ?? item.type)
      .join(" / ");
    return `${listed} など ${items.length} 件生成済みです。`;
  }
  if (plannedTypes.length > 0) {
    return `次に ${plannedTypes.join(", ")} の生成を行えます。`;
  }
  return "生成指示はまだありません。";
};

interface ProxyResponseContext {
  prompt: string;
  subject?: SubjectHint;
  tone?: string;
  related: SerializedMatch[];
  toolCalls: { tool: string; detail: string; result?: string }[];
  createdLearning?: Learning | null;
  shouldCreate: boolean;
  generatedItems: GeneratedContent[];
  plannedTypes: GenerateFromMaterialRequest["types"];
}

interface GeneratedContentSummary {
  id: string;
  type: GeneratedContent["type"];
  title: string;
  learningId?: string;
  learningTitle?: string;
}

interface ProxyActionsPayload {
  createdLearningId?: string;
  createdLearningTitle?: string;
  createdLearningSubject?: string;
  createdLearningReason?: string;
  generatedContentSummaries?: GeneratedContentSummary[];
}

const buildProxyActionsPayload = (
  prompt: string,
  createdLearning: Learning | null,
  generatedItems: GeneratedContent[],
  targetLearning?: SerializedMatch,
): ProxyActionsPayload => {
  const summaries =
    generatedItems.length > 0
      ? generatedItems.map((item) => ({
          id: item.id,
          type: item.type,
          title: summarizeText(flattenContent(item.content), 80),
          learningId: item.learningId,
          learningTitle: targetLearning?.label,
        }))
      : undefined;
  return {
    createdLearningId: createdLearning?.id,
    createdLearningTitle: createdLearning?.title,
    createdLearningSubject: createdLearning?.subject ?? undefined,
    createdLearningReason: createdLearning ? summarizeText(prompt, 160) : undefined,
    generatedContentSummaries: summaries,
  };
};

const buildProxyFallbackMessage = (ctx: ProxyResponseContext) => {
  const sections: string[] = [];
  if (ctx.subject) {
    sections.push(`テーマ: ${subjectLabelMap[ctx.subject] ?? ctx.subject}`);
  }
  sections.push(
    ctx.related.length > 0
      ? `関連候補:\n${describeRelatedBrief(ctx.related)}`
      : "既存の教材は見つかりませんでした。",
  );
  if (ctx.createdLearning) {
    sections.push(`チャット内容をもとに「${ctx.createdLearning.title}」という学習カードを用意しました。`);
  } else if (ctx.shouldCreate) {
    sections.push("ヒットが少ないため、新しい学習カードを提案しています。タイトルや科目の希望を教えてください。");
  }
  sections.push(`生成状況: ${describeGenerationSummary(ctx.generatedItems, ctx.plannedTypes)}`);
  sections.push("続けて、欲しい教材や問題の条件を教えてください。");
  return sections.join("\n\n");
};

const callOpenAiProxyChat = async (
  env: AppBindings | undefined,
  ctx: ProxyResponseContext,
) => {
  const apiKey = env?.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const model = env?.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const payload = {
    model,
    temperature: 0.4,
    messages: [
      {
        role: "system",
        content: `You are an educational AI assistant who plans study units and tool calls for teachers. Reply in Japanese, stay concise, and summarize what you already executed. ${ctx.tone ? `Adopt a ${ctx.tone} tone.` : ""}`,
      },
      {
        role: "user",
        content: [
          `ユーザー入力: ${summarizeText(ctx.prompt, 220)}`,
          `推定教科: ${ctx.subject ? subjectLabelMap[ctx.subject] ?? ctx.subject : "特定不可"}`,
          `関連候補:\n${describeRelatedBrief(ctx.related)}`,
          `ツール実行:\n${describeToolSummary(ctx.toolCalls)}`,
          `生成状況: ${describeGenerationSummary(ctx.generatedItems, ctx.plannedTypes)}`,
          ctx.createdLearning
            ? `新規学習カード「${ctx.createdLearning.title}」を作成済み。`
            : ctx.shouldCreate
              ? "学習カード作成を検討中。"
              : "既存の教材をもとに提案可。",
          "上記を踏まえて、次のアクション案と提案を返してください。",
        ].join("\n\n"),
      },
    ],
  };
  try {
    const response = await fetch(`${resolveOpenAiBaseUrl(env)}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`openai proxy chat failed (${response.status}): ${detail}`);
    }
    const json = await response.json() as { choices?: { message?: { content?: unknown } }[] };
    const content = joinChatContent(json.choices?.[0]?.message?.content);
    return content || null;
  } catch (error) {
    console.warn("proxy chat openai request failed", error);
    return null;
  }
};

const computeTokenOverlapScore = (expected: string, input: string) => {
  const normalize = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean);
  const expectedTokens = normalize(expected);
  const answerTokens = normalize(input);
  if (expectedTokens.length === 0 || answerTokens.length === 0) return 0;
  const overlap = answerTokens.filter((token) => expectedTokens.includes(token)).length;
  return Math.min(1, overlap / expectedTokens.length);
};

const buildSimilarQuestions = (question: PracticeGradingRequest["question"]): SimilarQuestion[] => {
  const prompt = summarizeText(question.prompt, 120);
  const hint = question.hint?.trim();
  return [
    {
      prompt: `言い換えパターン: ${prompt}`,
      hint: hint ?? "キーワードを落とさずに短く整理してみましょう。",
    },
    {
      prompt: `応用: ${prompt} を具体例で説明してください。`,
      hint: hint ?? "答えに具体例と理由を1つ添えてください。",
    },
  ];
};

const buildFallbackFeedback = (
  request: PracticeGradingRequest,
  details?: { reason?: string },
): PracticeFeedback => {
  const expected = request.question.expected ?? "";
  const score = expected ? computeTokenOverlapScore(expected, request.answer) : 0.4;
  const verdict = score >= 0.75 ? "correct" : score >= 0.45 ? "partial" : "incorrect";
  const comment =
    verdict === "correct"
      ? "主要なキーワードが一致しています。次は手順や理由をもう少し具体的に書いてみましょう。"
      : verdict === "partial"
        ? "一部のキーワードは合っていますが、答えが不足しているようです。ヒントや教材を見直してください。"
        : "答えが離れているようです。ヒントに沿って重要語句を入れ直してみてください。";

  return {
    score,
    verdict,
    comment,
    reasoning: expected
      ? `想定解: ${summarizeText(expected, 140)}`
      : "想定解がないため類似度ベースで採点しました。",
    keyPoints: expected ? [summarizeText(expected, 160)] : undefined,
    suggestedSimilar: buildSimilarQuestions(request.question),
    nextAction:
      verdict === "correct"
        ? "関連する類題で理解を確認しましょう。"
        : "回答を一旦短くまとめ、キーワードが含まれているかを確認してから再提出してください。",
    usedAi: false,
    raw: details?.reason,
  };
};

const gradeWithOpenAi = async (
  env: AppBindings | undefined,
  request: PracticeGradingRequest,
): Promise<PracticeFeedback | null> => {
  const apiKey = env?.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const model = env?.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const attachmentNote =
    request.artifacts && request.artifacts.length > 0
      ? `添付: 画像 ${request.artifacts.length} 件（内容は文字起こし済みとして扱ってください）`
      : "添付なし";
  const messages = [
    {
      role: "system",
      content:
        "You are a supportive Japanese tutor. Grade the student's answer strictly but give concise feedback. Respond ONLY with JSON.",
    },
    {
      role: "user",
      content: [
        `問題: ${summarizeText(request.question.prompt, 360)}`,
        request.question.expected ? `想定解: ${summarizeText(request.question.expected, 360)}` : "想定解: なし",
        request.question.hint ? `ヒント: ${summarizeText(request.question.hint, 160)}` : "ヒント: なし",
        `解答モード: ${request.mode}`,
        attachmentNote,
        `学習者の解答: ${summarizeText(request.answer, 640)}`,
        "以下のJSON形式で返してください: { \"score\": number (0-1), \"verdict\": \"correct\" | \"partial\" | \"incorrect\", \"comment\": string, \"reasoning\": string, \"keyPoints\": string[], \"suggestedSimilar\": [{\"prompt\": string, \"hint\"?: string}], \"nextAction\": string }",
      ].join("\n"),
    },
  ];

  try {
    const response = await fetch(`${resolveOpenAiBaseUrl(env)}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`openai grade failed (${response.status}): ${detail}`);
    }
    const json = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = joinChatContent(json.choices?.[0]?.message?.content);
    if (!content) return null;
    const parsed = practiceFeedbackSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      throw new Error("openai grade response schema mismatch");
    }
    return {
      ...parsed.data,
      usedAi: true,
      raw: content,
    };
  } catch (error) {
    console.warn("gradeWithOpenAi failed", error);
    return null;
  }
};

const executeToolCall = async (
  env: AppBindings | undefined,
  tool: z.infer<typeof toolCallSchema>["tool"],
  params: Record<string, unknown>,
  userId: string = DEFAULT_USER_ID,
) => {
  const db = env?.DB;

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
    const items = await listLearnings(db, query, userId);
    return { items };
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
    const materialText =
      typeof params.materialText === "string" && params.materialText.trim().length > 0
        ? params.materialText
        : undefined;
    const materialTitle =
      typeof params.materialTitle === "string" && params.materialTitle.trim().length > 0
        ? params.materialTitle.trim()
        : undefined;
    const learning = await insertLearning(db, { title, subject, tags }, userId, env);
    if (materialText) {
      const material = await createAdhocMaterialFromText(db, learning, materialText, env, {
        title: materialTitle ?? title,
        sourceLabel: "ai_chat_seed",
      });
      return { learning, material };
    }
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
      materialText: typeof params.materialText === "string" ? params.materialText : undefined,
      materialTitle: typeof params.materialTitle === "string" ? params.materialTitle : undefined,
      types: normalizedTypes,
      presetId: params.presetId,
      presetTitle: params.presetTitle,
      presetSystemPrompt: params.presetSystemPrompt,
      presetUserTemplate: params.presetUserTemplate,
    });
    const learning = await fetchLearning(db, request.learningId, userId);
    if (!learning) {
      throw new ToolCallError("not_found", "learning not found", 404);
    }
    const { material, createdFromText } = await resolveMaterialForGeneration(
      db,
      env,
      request,
      learning,
      userId,
    );
    const preset = await resolvePresetContext(db, request, userId);
    const { drafts, meta } = await generateContentsFromMaterial(env, request, learning, material, preset);
    const items: GeneratedContent[] = [];
    for (const draft of drafts) {
      items.push(await saveGeneratedContent(db, { ...draft, userId }, userId, env));
    }
    const job = buildGenerationJob(request.types, preset, {
      modelName: meta.modelName,
      tokens: meta.tokens,
    });
    return { material, items, job, materialCreatedFromText: createdFromText };
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
    const saved = await saveGeneratedContent(db, { ...parsed.data, userId }, userId, env);
    return { content: saved };
  }

  throw new ToolCallError("unsupported_tool", `tool "${tool}" is not supported`, 400);
};

export {
  createSession,
  createUser,
  ensureDefaultUser,
  fetchUserByEmail,
  generateSessionToken,
  hashToken,
  requireAuth,
  resolveAuthContext,
  updateUserProfile,
  DEFAULT_USER_DISPLAY_NAME,
} from "./core/auth";

export { ensureMaterialTables, ensurePrismaSchema, ensureUserTables } from "./core/prisma";
export {
  deleteLibraryAssetsForMaterial,
  fetchIngestJob,
  fetchLibraryAsset,
  fetchLibraryEntryById,
  listIngestJobs,
  listLibraryEntries,
  saveIngestJob,
  saveLibraryAsset,
  saveLibraryEntry,
  sanitizeFileNameForHeader,
} from "./core/library";

export {
  app,
  attachEmbeddingsToChunks,
  authSessionResponseSchema,
  bootstrapSessionRequestSchema,
  buildFallbackFeedback,
  buildGenerationJob,
  buildIngestJob,
  buildLibraryAssetPayload,
  buildLibraryEntryRecord,
  buildLearningTagsFromPrompt,
  buildLearningTitleFromPrompt,
  buildProxyActionsPayload,
  buildProxyFallbackMessage,
  callOpenAiForGeneration,
  callOpenAiProxyChat,
  calculateLearningProgress,
  chunkMaterialText,
  cloneIngestJob,
  DEFAULT_GENERATION_TEMPERATURE,
  DEFAULT_USER_ID,
  deleteSemanticNodesByRef,
  determineGenerationTypes,
  embedRequestSchema,
  enqueueIngestJobProcessing,
  ensureCoreTables,
  executeToolCall,
  fetchIngestJob,
  fetchLearning,
  fetchLibraryAsset,
  fetchLibraryEntryById,
  fetchMaterial,
  fetchPreset,
  generateContentsFromMaterial,
  generateEmbeddings,
  generateFromMaterialRequestSchema,
  getPrismaClient,
  gradeWithOpenAi,
  ingestJobListQuerySchema,
  ingestMaterialRequestSchema,
  insertLearning,
  isUuid,
  issueSessionRequestSchema,
  learningListQuerySchema,
  libraryEntryListQuerySchema,
  listLearnings,
  mapGeneratedContent,
  mapLearning,
  mapMaterial,
  mapPracticeSession,
  mapPreset,
  materialIngestResultSchema,
  nowIso,
  prepareJobForProcessing,
  presetListQuerySchema,
  PREPROCESS_STEP_KINDS,
  practiceGradingRequestSchema,
  proxyRequestSchema,
  resolveMaterialForGeneration,
  resolveOpenAiBaseUrl,
  resolvePresetContext,
  saveGeneratedContent,
  saveIngestJob,
  searchSemantic,
  semanticSearchRequestSchema,
  serializeMatchesForClient,
  shouldCreateLearningFromPrompt,
  summarizeText,
  toEmbedding,
  toolCallSchema,
  ToolCallError,
  updateLearningSchema,
  updateLearningProgress,
  updateMaterialSchema,
  updatePresetSchema,
  updateUserProfileRequestSchema,
  upsertGeneratedSchema,
  upsertLearningSchema,
  upsertMaterialSchema,
  upsertPresetSchema,
  upsertSessionSchema,
  detectSubjectFromPrompt,
  extractMaterialFromSource,
  indexGeneratedContentSemanticNode,
  indexLearningSemanticNode,
  indexMaterialSemanticNode,
  indexPracticeQuestionSemanticNode,
};

export type {
  AppBindings,
  AppEnv,
  AuthContext,
  LibraryAssetPayload,
  MaterialChunkRecord,
  ProxyResponseContext,
  SemanticMatch,
};
