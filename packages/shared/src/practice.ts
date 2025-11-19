import { z } from "zod";

export const practiceModeSchema = z.enum(["handwriting", "text"]);

export const practiceQuestionSchema = z.object({
  prompt: z.string().min(1),
  expected: z.string().optional(),
  hint: z.string().optional(),
  title: z.string().optional(),
  subject: z.string().optional(),
});

export const practiceArtifactSchema = z.object({
  kind: z.enum(["image"]),
  dataUrl: z.string().min(1),
  name: z.string().optional(),
  mimeType: z.string().optional(),
});

export const similarQuestionSchema = z.object({
  prompt: z.string().min(1),
  expected: z.string().optional(),
  hint: z.string().optional(),
  difficulty: z.string().optional(),
});

export const practiceFeedbackSchema = z.object({
  score: z.number().min(0).max(1),
  verdict: z.enum(["correct", "partial", "incorrect"]),
  comment: z.string(),
  reasoning: z.string().optional(),
  keyPoints: z.array(z.string().min(1)).optional(),
  suggestedSimilar: z.array(similarQuestionSchema).optional(),
  nextAction: z.string().optional(),
  usedAi: z.boolean().optional(),
  raw: z.string().optional(),
});

export const practiceGradingRequestSchema = z.object({
  question: practiceQuestionSchema,
  answer: z.string().min(1),
  mode: practiceModeSchema.default("text"),
  artifacts: z.array(practiceArtifactSchema).optional(),
});

export const practiceGradingResponseSchema = z.object({
  feedback: practiceFeedbackSchema,
  requestEcho: practiceGradingRequestSchema.optional(),
});

export type PracticeMode = z.infer<typeof practiceModeSchema>;
export type PracticeQuestion = z.infer<typeof practiceQuestionSchema>;
export type PracticeArtifact = z.infer<typeof practiceArtifactSchema>;
export type SimilarQuestion = z.infer<typeof similarQuestionSchema>;
export type PracticeFeedback = z.infer<typeof practiceFeedbackSchema>;
export type PracticeGradingRequest = z.infer<typeof practiceGradingRequestSchema>;
export type PracticeGradingResponse = z.infer<typeof practiceGradingResponseSchema>;
