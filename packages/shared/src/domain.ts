import { z } from "zod";
import { practiceFeedbackSchema } from "./practice";

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

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().optional(),
  displayName: z.string().min(1).optional(),
  credits: z.number().int().min(0).default(0),
  createdAt: isoDateTimeString,
  updatedAt: isoDateTimeString,
  lastSeenAt: isoDateTimeString.optional(),
});

export const userSessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  deviceName: z.string().min(1).optional(),
  expiresAt: isoDateTimeString.optional(),
  lastSeenAt: isoDateTimeString.optional(),
  createdAt: isoDateTimeString,
  updatedAt: isoDateTimeString,
});

export const learningSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().optional(),
  title: z.string().min(1),
  subject: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).optional(),
  progress: z.number().min(0).max(1).optional(),
  createdAt: isoDateTimeString,
  updatedAt: isoDateTimeString,
});

// Material metadata schema
export const materialMetadataSchema = z
  .object({
    name: z.string().optional(),
    payloadFileName: z.string().optional(),
    payloadBytes: z.number().optional(),
    previewUrl: z.string().optional(),
    payloadDataUrlPreview: z.string().optional(),
  })
  .passthrough(); // Allow additional properties

export const materialSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().optional(),
  learningId: z.string().uuid(),
  type: materialTypeSchema,
  sourcePath: z.string().url().or(z.string().min(1)).optional(),
  rawContent: z.string().optional(),
  metadata: materialMetadataSchema.optional(),
  createdAt: isoDateTimeString,
  updatedAt: isoDateTimeString,
});

export const generatedContentSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().optional(),
  learningId: z.string().uuid(),
  materialId: z.string().uuid().optional(),
  type: generatedContentTypeSchema,
  content: z.record(z.string(), z.unknown()),
  promptPreset: z.string().min(1).optional(),
  createdAt: isoDateTimeString,
});

// Practice session question reference schema
export const questionRefSchema = z
  .object({
    title: z.string().optional(),
    prompt: z.string().optional(),
  })
  .passthrough(); // Allow additional properties

export const practiceSessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().optional(),
  learningId: z.string().uuid(),
  generatedContentId: z.string().uuid().optional(),
  questionRef: questionRefSchema.optional(),
  answerText: z.string().min(1),
  isCorrect: z.boolean().optional(),
  feedback: practiceFeedbackSchema.optional(),
  score: z.number().min(0).max(1).optional(),
  createdAt: isoDateTimeString,
});

export const presetSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().optional(),
  subject: z.string().min(1),
  title: z.string().min(1),
  systemPrompt: z.string().min(1),
  userInstructionTemplate: z.string().min(1),
  createdAt: isoDateTimeString,
  updatedAt: isoDateTimeString,
});

export const semanticNodeSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().optional(),
  refType: refTypeSchema,
  refId: z.string().uuid(),
  embedding: z.array(z.number()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const schemas = {
  user: userSchema,
  userSession: userSessionSchema,
  learning: learningSchema,
  material: materialSchema,
  generatedContent: generatedContentSchema,
  practiceSession: practiceSessionSchema,
  preset: presetSchema,
  semanticNode: semanticNodeSchema,
};

export type User = z.infer<typeof userSchema>;
export type UserSession = z.infer<typeof userSessionSchema>;
export type Learning = z.infer<typeof learningSchema>;
export type Material = z.infer<typeof materialSchema>;
export type MaterialMetadata = z.infer<typeof materialMetadataSchema>;
export type GeneratedContent = z.infer<typeof generatedContentSchema>;
export type PracticeSession = z.infer<typeof practiceSessionSchema>;
export type QuestionRef = z.infer<typeof questionRefSchema>;
export type Preset = z.infer<typeof presetSchema>;
export type SemanticNode = z.infer<typeof semanticNodeSchema>;
export type MaterialType = z.infer<typeof materialTypeSchema>;
export type GeneratedContentType = z.infer<typeof generatedContentTypeSchema>;
export type RefType = z.infer<typeof refTypeSchema>;
