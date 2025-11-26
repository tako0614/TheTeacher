import { z } from "zod";

import { isoDateTimeString, materialSchema, materialTypeSchema } from "./domain";

export const ocrEngineSchema = z.enum([
  "openai_vision",
  "cloudflare_workers_ai",
]);

export const transcriptionEngineSchema = z.enum([
  "whisper_rs",
  "assemblyai",
]);

export const ingestSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pdf"),
    path: z.string().min(1),
  }),
  z.object({
    kind: z.literal("image"),
    path: z.string().min(1),
  }),
  z.object({
    kind: z.literal("audio"),
    path: z.string().min(1),
  }),
  z.object({
    kind: z.literal("video"),
    path: z.string().min(1),
  }),
  z.object({
    kind: z.literal("url"),
    url: z.string().url(),
  }),
  z.object({
    kind: z.literal("text"),
    text: z.string().min(1),
  }),
]);

export const ingestStepSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum([
    "download",
    "ocr",
    "transcription",
    "chunking",
    "embedding",
    "metadata",
  ]),
  status: z.enum(["pending", "running", "succeeded", "failed"]),
  startedAt: isoDateTimeString.optional(),
  finishedAt: isoDateTimeString.optional(),
  error: z.string().optional(),
});

export const ingestJobSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().optional(),
  learningId: z.string().uuid().optional(),
  source: ingestSourceSchema,
  status: z.enum(["queued", "processing", "completed", "failed"]),
  requestedAt: isoDateTimeString,
  updatedAt: isoDateTimeString,
  preferredOcrEngine: ocrEngineSchema.optional(),
  preferredTranscriptionEngine: transcriptionEngineSchema.optional(),
  steps: z.array(ingestStepSchema),
  notes: z.string().optional(),
  outputMaterialId: z.string().uuid().optional(),
  libraryPath: z.string().optional(),
});

export const libraryConfigSchema = z.object({
  rootDir: z.string().min(1),
  tempDir: z.string().min(1),
  indexFile: z.string().min(1),
});

export const libraryEntrySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().optional(),
  displayName: z.string().min(1),
  storedPath: z.string().min(1),
  assetPath: z.string().min(1).optional(),
  type: materialTypeSchema,
  bytes: z.number().int().nonnegative().optional(),
  learningId: z.string().uuid().optional(),
  materialId: z.string().uuid().optional(),
  libraryPath: z.string().min(1).optional(),
  originalSource: ingestSourceSchema.optional(),
  notes: z.string().optional(),
  createdAt: isoDateTimeString,
  updatedAt: isoDateTimeString,
});

export const ingestRequestSchema = z.object({
  source: ingestSourceSchema,
  learningId: z.string().uuid().optional(),
  preferOffline: z.boolean().optional(),
  ocrEngine: ocrEngineSchema.optional(),
  transcriptionEngine: transcriptionEngineSchema.optional(),
  payload: z
    .object({
      text: z.string().min(1).optional(),
      dataUrl: z.string().startsWith("data:").optional(),
      fileName: z.string().min(1).optional(),
      bytes: z.number().int().nonnegative().optional(),
      mimeType: z.string().min(1).optional(),
    })
    .optional(),
});

export type IngestSource = z.infer<typeof ingestSourceSchema>;
export type IngestStep = z.infer<typeof ingestStepSchema>;
export type IngestJob = z.infer<typeof ingestJobSchema>;
export type MaterialLibraryConfig = z.infer<typeof libraryConfigSchema>;
export type MaterialLibraryEntry = z.infer<typeof libraryEntrySchema>;
export type MaterialIngestRequest = z.infer<typeof ingestRequestSchema>;

export const extractedSummarySchema = z.object({
  preview: z.string().min(1),
  tokens: z.number().int().nonnegative().optional(),
  format: z.enum(["plain", "ocr", "transcript", "scraped"]).default("plain"),
});

export const materialIngestResultSchema = z.object({
  material: materialSchema,
  job: ingestJobSchema,
  extracted: extractedSummarySchema.optional(),
});

export type ExtractedSummary = z.infer<typeof extractedSummarySchema>;
export type MaterialIngestResult = z.infer<typeof materialIngestResultSchema>;
