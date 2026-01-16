import { z } from "zod";

const openAiImageDetailSchema = z.enum(["low", "high"]);

export const openAiChatContentPartSchema = z.union([
  z.object({
    type: z.literal("text"),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal("image_url"),
    image_url: z.object({
      url: z.string().min(1),
      detail: openAiImageDetailSchema.optional(),
    }),
  }),
]);

export const openAiChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.union([z.string().min(1), z.array(openAiChatContentPartSchema).min(1)]),
});

export const openAiChatProxyRequestSchema = z.object({
  model: z.string().trim().min(1).default("gpt-4o-mini").optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(4096).optional(),
  messages: z.array(openAiChatMessageSchema).min(1).max(20),
});

export const openAiUsageSchema = z
  .object({
    promptTokens: z.number().optional(),
    completionTokens: z.number().optional(),
    totalTokens: z.number().optional(),
  })
  .optional();

export const openAiChatProxyResponseSchema = z.object({
  text: z.string(),
  model: z.string().optional(),
  usage: openAiUsageSchema,
});

export const aiImageInputSchema = z.object({
  dataUrl: z.string().min(1),
  detail: openAiImageDetailSchema.optional(),
});

export const materialGenerateRequestSchema = z
  .object({
    materialText: z.string().trim().min(1).max(16_000).optional(),
    materialTitle: z.string().trim().min(1).max(120).optional(),
    images: z.array(aiImageInputSchema).max(4).optional(),
    qaCount: z.number().int().min(1).max(20).default(6).optional(),
    practiceCount: z.number().int().min(1).max(20).default(6).optional(),
    includeSummary: z.boolean().default(true).optional(),
  })
  .refine((value) => Boolean(value.materialText) || Boolean(value.images?.length), {
    message: "materialText or images is required",
    path: ["materialText"],
  });

export const generatedQaItemSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  explanation: z.string().min(1).optional(),
  difficulty: z.string().min(1).optional(),
});

export const generatedSummarySchema = z.object({
  title: z.string().min(1).optional(),
  bullets: z.array(z.string().min(1)).min(1).max(12),
});

export const materialGenerateResponseSchema = z.object({
  qa: z.array(generatedQaItemSchema),
  practice: z.array(
    z.object({
      prompt: z.string().min(1),
      expected: z.string().min(1).optional(),
      hint: z.string().min(1).optional(),
      difficulty: z.string().min(1).optional(),
    }),
  ),
  summary: generatedSummarySchema.optional(),
  model: z.string().optional(),
  usage: openAiUsageSchema,
});

export type OpenAiChatMessage = z.infer<typeof openAiChatMessageSchema>;
export type OpenAiChatProxyRequest = z.infer<typeof openAiChatProxyRequestSchema>;
export type OpenAiChatProxyResponse = z.infer<typeof openAiChatProxyResponseSchema>;
export type MaterialGenerateRequest = z.infer<typeof materialGenerateRequestSchema>;
export type MaterialGenerateResponse = z.infer<typeof materialGenerateResponseSchema>;
export type GeneratedQaItem = z.infer<typeof generatedQaItemSchema>;
