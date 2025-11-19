import { z } from "zod";
import {
  schemas,
  refTypeSchema,
  ingestRequestSchema,
} from "@theteacher/shared";

export const proxyRequestSchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
  model: z.string().default("gpt-4o-mini"),
  topK: z.number().int().min(1).max(10).default(3).optional(),
  tone: z.string().trim().min(1).optional(),
});

export const embedRequestSchema = z.object({
  texts: z.array(z.string().min(1)).min(1),
});

export const semanticSearchRequestSchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().min(1).max(10).default(5),
  refType: refTypeSchema.optional(),
  subject: z.string().min(1).optional(),
});

export const learningListQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  subject: z.string().trim().min(1).optional(),
  tag: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const presetListQuerySchema = z.object({
  subject: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const ingestJobListQuerySchema = z.object({
  learningId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const libraryEntryListQuerySchema = z.object({
  learningId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const toolCallSchema = z.object({
  tool: z.enum([
    "search_learnings",
    "create_learning_from_chat",
    "generate_questions",
    "save_content",
  ]),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const upsertLearningSchema = schemas.learning
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

export const updateLearningSchema = upsertLearningSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: "at least one field is required" },
);

export const upsertMaterialSchema = schemas.material
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

export const updateMaterialSchema = upsertMaterialSchema
  .omit({ learningId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field is required",
  });

export const ingestMaterialRequestSchema = ingestRequestSchema.extend({
  learningId: z.string().uuid(),
});

export const upsertGeneratedSchema = schemas.generatedContent
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

export const upsertSessionSchema = schemas.practiceSession
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

export const upsertPresetSchema = schemas.preset
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

export const updatePresetSchema = upsertPresetSchema
  .omit({ id: true })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "at least one field is required",
  });
