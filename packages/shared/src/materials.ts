import { z } from "zod";

import { isoDateTimeString, materialTypeSchema } from "./domain";

export const ocrEngineSchema = z.enum([
  "native_tesseract",
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
  displayName: z.string().min(1),
  storedPath: z.string().min(1),
  type: materialTypeSchema,
  bytes: z.number().int().nonnegative().optional(),
  originalSource: ingestSourceSchema.optional(),
  createdAt: isoDateTimeString,
  updatedAt: isoDateTimeString,
});

export const ingestRequestSchema = z.object({
  source: ingestSourceSchema,
  learningId: z.string().uuid().optional(),
  preferOffline: z.boolean().optional(),
  ocrEngine: ocrEngineSchema.optional(),
  transcriptionEngine: transcriptionEngineSchema.optional(),
});

export type IngestSource = z.infer<typeof ingestSourceSchema>;
export type IngestStep = z.infer<typeof ingestStepSchema>;
export type IngestJob = z.infer<typeof ingestJobSchema>;
export type MaterialLibraryConfig = z.infer<typeof libraryConfigSchema>;
export type MaterialLibraryEntry = z.infer<typeof libraryEntrySchema>;
export type MaterialIngestRequest = z.infer<typeof ingestRequestSchema>;
