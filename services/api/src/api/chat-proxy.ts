import type { OpenAiChatProxyRequest, OpenAiChatProxyResponse } from "@theteacher/shared";
import { openAiChatProxyResponseSchema } from "@theteacher/shared";

import { ToolCallError } from "../core/errors";
import type { AppBindings } from "../core/types";
import { callOpenAiChatCompletion, type OpenAiChatMessage } from "./openai";

const isAllowedOpenAiModel = (value: string) => {
  const model = value.trim();
  if (!model) return false;
  if (model === "gpt-4o-mini") return true;
  if (model.startsWith("gpt-4o-mini-")) return true;
  return false;
};

const hasVisionParts = (messages: OpenAiChatMessage[]) =>
  messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === "image_url" && Boolean(part.image_url?.url)),
  );

const flattenMessageContent = (content: OpenAiChatMessage["content"]) => {
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
};

export const buildFallbackChatProxyResponse = (
  request: OpenAiChatProxyRequest,
): OpenAiChatProxyResponse => {
  const requestedModel = request.model?.trim() || "gpt-4o-mini";
  if (!isAllowedOpenAiModel(requestedModel)) {
    throw new ToolCallError("invalid_request", `model is not allowed: ${requestedModel}`, 400);
  }
  const lastUser = [...request.messages].reverse().find((message) => message.role === "user");
  const prompt = lastUser ? flattenMessageContent(lastUser.content as OpenAiChatMessage["content"]) : "";
  const text = prompt
    ? `（デモ応答）: ${prompt.trim().slice(0, 500)}`
    : "（デモ応答）メッセージを送ってください。";
  return openAiChatProxyResponseSchema.parse({ text, model: "fallback" });
};

export const chatProxyWithOpenAi = async (
  env: AppBindings | undefined,
  request: OpenAiChatProxyRequest,
): Promise<OpenAiChatProxyResponse> => {
  const apiKey = env?.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new ToolCallError("openai_not_configured", "OPENAI_API_KEY is not configured", 503);
  }

  const requestedModel = request.model?.trim() || "gpt-4o-mini";
  if (!isAllowedOpenAiModel(requestedModel)) {
    throw new ToolCallError("invalid_request", `model is not allowed: ${requestedModel}`, 400);
  }

  const preferVision = hasVisionParts(request.messages as OpenAiChatMessage[]);
  const { text, model, usage } = await callOpenAiChatCompletion(env, {
    messages: request.messages as OpenAiChatMessage[],
    model: requestedModel,
    preferVision,
    temperature: request.temperature,
    maxTokens: request.maxTokens,
  });

  return openAiChatProxyResponseSchema.parse({ text, model, usage });
};
