import type { MaterialGenerateRequest, MaterialGenerateResponse } from "@theteacher/shared";
import { materialGenerateResponseSchema } from "@theteacher/shared";

import type { AppBindings } from "../core/types";
import { ToolCallError } from "../core/errors";
import { callOpenAiChatCompletion } from "./openai";
import { summarizeText } from "./utils";

const normalizeText = (value?: string) => (typeof value === "string" ? value.replaceAll("\u0000", " ").trim() : "");

export const buildFallbackMaterialGeneration = (request: MaterialGenerateRequest): MaterialGenerateResponse => {
  const material = normalizeText(request.materialText);
  const title = request.materialTitle?.trim() || "教材";
  const seed = material || "（教材テキストなし）";
  const bullets = summarizeText(seed, 320)
    .split(/(?<=[。.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);

  const qa = Array.from({ length: Math.min(request.qaCount ?? 6, 6) }, (_, idx) => ({
    question: `${title}の要点を${idx === 0 ? "一言で" : "別の言い方で"}説明すると？`,
    answer: bullets[idx % Math.max(1, bullets.length)] ?? summarizeText(seed, 120),
  }));

  const practice = Array.from({ length: Math.min(request.practiceCount ?? 6, 6) }, (_, idx) => ({
    prompt: `${title}について確認: ${idx + 1}. ${bullets[idx % Math.max(1, bullets.length)] ?? "重要語句を挙げて説明してください。"}`,
    hint: "教材のキーワードを2〜3個含めて書いてみましょう。",
  }));

  const response: MaterialGenerateResponse = {
    qa,
    practice,
    summary: request.includeSummary === false ? undefined : { title, bullets: bullets.length ? bullets : [summarizeText(seed, 80)] },
    model: "fallback",
  };

  return materialGenerateResponseSchema.parse(response);
};

export const generateMaterialWithOpenAi = async (
  env: AppBindings | undefined,
  request: MaterialGenerateRequest,
): Promise<MaterialGenerateResponse> => {
  const hasImages = Boolean(request.images?.length);
  const materialText = normalizeText(request.materialText);
  const qaCount = request.qaCount ?? 6;
  const practiceCount = request.practiceCount ?? 6;
  const includeSummary = request.includeSummary !== false;

  const { text, model, usage } = await callOpenAiChatCompletion(env, {
    preferVision: hasImages,
    temperature: 0.3,
    maxTokens: 1300,
    responseFormat: "json_object",
    messages: [
      {
        role: "system",
        content:
          "You are an educational content generator. Reply ONLY with JSON. All text must be Japanese.\n" +
          'Return an object with keys: "qa", "practice", and (optional) "summary".\n' +
          `"qa" is an array of {question, answer, explanation?, difficulty?}.\n` +
          `"practice" is an array of {prompt, expected?, hint?, difficulty?}.\n` +
          `"summary" is {title?, bullets:[...]}.\n` +
          "Keep items short and concrete. Do not include markdown fences.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `教材タイトル: ${request.materialTitle?.trim() || "未指定"}`,
              `生成数: qa=${qaCount}, practice=${practiceCount}, summary=${includeSummary ? "yes" : "no"}`,
              materialText ? `教材テキスト:\n${materialText}` : "教材テキスト: （なし）",
              hasImages ? `添付画像: ${request.images?.length ?? 0} 枚` : "添付画像: なし",
            ].join("\n\n"),
          },
          ...(request.images ?? []).map((image) => ({
            type: "image_url" as const,
            image_url: { url: image.dataUrl, detail: image.detail ?? "low" },
          })),
        ],
      },
    ],
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch (error) {
    throw new ToolCallError(
      "generation_failed",
      `OpenAI response was not valid JSON: ${error instanceof Error ? error.message : "unknown error"}`,
      502,
    );
  }

  const normalized = materialGenerateResponseSchema
    .pick({ qa: true, practice: true, summary: true })
    .safeParse(parsedJson);
  if (!normalized.success) {
    throw new ToolCallError("generation_failed", "OpenAI response schema mismatch", 502);
  }

  const response: MaterialGenerateResponse = {
    ...normalized.data,
    model,
    usage,
  };

  return materialGenerateResponseSchema.parse(response);
};

