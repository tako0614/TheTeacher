import { z } from "zod";

import {
  generatedContentSchema,
  generatedContentTypeSchema,
  isoDateTimeString,
  materialSchema,
} from "./domain";

export const generateFromMaterialRequestSchema = z.object({
  learningId: z.string().uuid(),
  materialId: z.string().uuid().optional(),
  types: z.array(generatedContentTypeSchema).min(1).default(["qa"]),
  presetId: z.string().uuid().optional(),
  presetTitle: z.string().min(1).optional(),
  presetSystemPrompt: z.string().min(1).optional(),
  presetUserTemplate: z.string().min(1).optional(),
});

export const generationJobSchema = z.object({
  createdAt: isoDateTimeString,
  completedAt: isoDateTimeString.optional(),
  presetTitle: z.string().optional(),
  types: z.array(generatedContentTypeSchema),
  notes: z.string().optional(),
});

export const generationResultSchema = z.object({
  material: materialSchema.optional(),
  job: generationJobSchema,
  items: z.array(generatedContentSchema),
});

export type GenerateFromMaterialRequest = z.infer<
  typeof generateFromMaterialRequestSchema
>;
export type GenerationJob = z.infer<typeof generationJobSchema>;
export type GenerationResult = z.infer<typeof generationResultSchema>;
