import { z } from "zod";

export const isoDateTimeString = z.string().datetime({ offset: true });

export const materialTypeSchema = z.enum([
  "text",
  "pdf",
  "image",
  "audio",
  "video",
  "url",
]);

export const generatedContentTypeSchema = z.enum([
  "qa",
  "practice",
  "summary",
  "podcast_script",
  "other",
]);

export const refTypeSchema = z.enum([
  "learning",
  "material",
  "generated_content",
  "question",
]);

export const learningSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  subject: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).optional(),
  progress: z.number().min(0).max(1).optional(),
  createdAt: isoDateTimeString,
  updatedAt: isoDateTimeString,
});

export const materialSchema = z.object({
  id: z.string().uuid(),
  learningId: z.string().uuid(),
  type: materialTypeSchema,
  sourcePath: z.string().url().or(z.string().min(1)).optional(),
  rawContent: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: isoDateTimeString,
  updatedAt: isoDateTimeString,
});

export const generatedContentSchema = z.object({
  id: z.string().uuid(),
  learningId: z.string().uuid(),
  materialId: z.string().uuid().optional(),
  type: generatedContentTypeSchema,
  content: z.record(z.string(), z.unknown()),
  promptPreset: z.string().min(1).optional(),
  createdAt: isoDateTimeString,
});

export const practiceSessionSchema = z.object({
  id: z.string().uuid(),
  learningId: z.string().uuid(),
  generatedContentId: z.string().uuid().optional(),
  questionRef: z.record(z.string(), z.unknown()).optional(),
  answerText: z.string().min(1),
  isCorrect: z.boolean().optional(),
  feedback: z.record(z.string(), z.unknown()).optional(),
  score: z.number().min(0).max(1).optional(),
  createdAt: isoDateTimeString,
});

export const presetSchema = z.object({
  id: z.string().uuid(),
  subject: z.string().min(1),
  title: z.string().min(1),
  systemPrompt: z.string().min(1),
  userInstructionTemplate: z.string().min(1),
  createdAt: isoDateTimeString,
  updatedAt: isoDateTimeString,
});

export const semanticNodeSchema = z.object({
  id: z.string().uuid(),
  refType: refTypeSchema,
  refId: z.string().uuid(),
  embedding: z.array(z.number()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const schemas = {
  learning: learningSchema,
  material: materialSchema,
  generatedContent: generatedContentSchema,
  practiceSession: practiceSessionSchema,
  preset: presetSchema,
  semanticNode: semanticNodeSchema,
};

export type Learning = z.infer<typeof learningSchema>;
export type Material = z.infer<typeof materialSchema>;
export type GeneratedContent = z.infer<typeof generatedContentSchema>;
export type PracticeSession = z.infer<typeof practiceSessionSchema>;
export type Preset = z.infer<typeof presetSchema>;
export type SemanticNode = z.infer<typeof semanticNodeSchema>;
export type MaterialType = z.infer<typeof materialTypeSchema>;
export type GeneratedContentType = z.infer<typeof generatedContentTypeSchema>;
export type RefType = z.infer<typeof refTypeSchema>;
