import type { ContentfulStatusCode } from "hono/utils/http-status";

import { ToolCallError } from "../core/errors";
import type { AppBindings } from "../core/types";
import { joinChatContent } from "./utils";

const defaultOpenAiBaseUrl = "https://api.openai.com/v1";

export const resolveOpenAiBaseUrl = (env?: AppBindings) =>
  (env?.OPENAI_API_BASE_URL?.trim() || defaultOpenAiBaseUrl).replace(/\/$/, "");

export interface DataUrlPayload {
  mimeType: string;
  bytes: Uint8Array;
  size: number;
}

const formatSrtTimestamp = (value: number) => {
  const totalMs = Math.max(0, Math.round(value * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const milliseconds = totalMs % 1000;
  const pad = (num: number, size: number) => String(num).padStart(size, "0");
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(milliseconds, 3)}`;
};

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

const segmentsToSrt = (segments: TranscriptSegment[]) =>
  segments
    .map((segment, index) => {
      const start = formatSrtTimestamp(segment.start);
      const end = formatSrtTimestamp(segment.end);
      const text = segment.text.trim();
      return `${index + 1}\n${start} --> ${end}\n${text}`;
    })
    .join("\n\n")
    .trim();

export const transcribeWithOpenAi = async (
  env: AppBindings | undefined,
  data: DataUrlPayload,
  details?: { fileName?: string; includeSegments?: boolean },
) => {
  const apiKey = env?.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured for transcription");
  }
  const model = env?.OPENAI_TRANSCRIPTION_MODEL?.trim() || "whisper-1";
  const form = new FormData();
  form.append(
    "file",
    new File([data.bytes.buffer as ArrayBuffer], details?.fileName || `material-${Date.now()}`, { type: data.mimeType }),
  );
  form.append("model", model);
  form.append("response_format", details?.includeSegments ? "verbose_json" : "json");
  form.append("temperature", "0");
  form.append("language", "ja");
  const response = await fetch(`${resolveOpenAiBaseUrl(env)}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`OpenAI transcription failed (${response.status}): ${detail}`);
  }
  if (details?.includeSegments) {
    const json = (await response.json()) as {
      text?: string;
      segments?: { start?: number; end?: number; text?: string }[];
    };
    const segments: TranscriptSegment[] = Array.isArray(json.segments)
      ? json.segments
          .map((segment) => ({
            start: typeof segment.start === "number" ? segment.start : Number(segment.start ?? NaN),
            end: typeof segment.end === "number" ? segment.end : Number(segment.end ?? NaN),
            text: typeof segment.text === "string" ? segment.text.trim() : String(segment.text ?? "").trim(),
          }))
          .filter(
            (segment) =>
              Number.isFinite(segment.start) &&
              Number.isFinite(segment.end) &&
              segment.text.length > 0,
          )
      : [];
    const subtitleSrt = segments.length ? segmentsToSrt(segments) : undefined;
    const text = (json.text ?? segments.map((segment) => segment.text).join("\n")).trim();
    if (!text) {
      throw new Error("OpenAI transcription response did not contain text");
    }
    return { text, model, segments, subtitleSrt };
  }
  const json = (await response.json()) as { text?: string };
  const text = json.text?.trim() ?? "";
  if (!text) {
    throw new Error("OpenAI transcription response did not contain text");
  }
  return { text, model };
};

export const visionOcrWithOpenAi = async (env: AppBindings | undefined, dataUrl: string) => {
  const apiKey = env?.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured for OCR");
  }
  const model = env?.OPENAI_VISION_MODEL?.trim() || env?.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const response = await fetch(`${resolveOpenAiBaseUrl(env)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are an expert educational content digitizer. Your task is to convert the provided image (textbook page, handwritten note, or slide) into structured Markdown text. \n" +
            "- Use LaTeX for math equations (e.g., $x^2$) where appropriate. \n" +
            "- Preserve headings, lists, and emphasis. \n" +
            "- If the image contains diagrams, charts, or illustrations, provide a brief text description in italics (e.g., *[Diagram showing ...]*) inline with the content. \n" +
            "- Do not output conversational filler. Output only the digitized content.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Digitize the content of this image into structured Markdown.",
            },
            {
              type: "image_url",
              image_url: {
                url: dataUrl,
                detail: "high",
              },
            },
          ],
        },
      ],
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`OpenAI vision request failed (${response.status}): ${detail}`);
  }
  const json = (await response.json()) as { choices?: { message?: { content?: unknown } }[]; model?: string };
  const content = joinChatContent(json.choices?.[0]?.message?.content);
  if (!content) {
    throw new Error("OpenAI vision response did not contain any text");
  }
  return { text: content, model };
};

export const generateSpeechWithOpenAi = async (
  env: AppBindings | undefined,
  text: string,
  voice: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" = "alloy",
) => {
  const apiKey = env?.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured for TTS");
  }
  const model = env?.OPENAI_TTS_MODEL?.trim() || "tts-1";

  const response = await fetch(`${resolveOpenAiBaseUrl(env)}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: text,
      voice,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`OpenAI TTS failed (${response.status}): ${detail}`);
  }

  const buffer = await response.arrayBuffer();
  return { buffer, model };
};

export const DEFAULT_GENERATION_TEMPERATURE = 0.35;

const ensureOpenAiGenerationConfig = (env?: AppBindings) => {
  const apiKey = env?.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new ToolCallError("openai_not_configured", "OPENAI_API_KEY is not configured", 503);
  }
  const model = env?.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  return { apiKey, model };
};

export const callOpenAiForGeneration = async (
  env: AppBindings | undefined,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options?: { temperature?: number; maxTokens?: number },
) => {
  const { apiKey, model } = ensureOpenAiGenerationConfig(env);
  const response = await fetch(`${resolveOpenAiBaseUrl(env)}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: options?.temperature ?? DEFAULT_GENERATION_TEMPERATURE,
      max_tokens: options?.maxTokens ?? 1100,
      response_format: { type: "json_object" },
      messages,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new ToolCallError(
      "generation_failed",
      `OpenAI request failed (${response.status}): ${detail}`,
      response.status as ContentfulStatusCode,
    );
  }
  const json = await response.json() as { 
    choices?: { message?: { content?: unknown } }[]; 
    model?: string; 
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  };
  const content = joinChatContent(json.choices?.[0]?.message?.content);
  if (!content) {
    throw new ToolCallError("generation_failed", "OpenAI response did not contain any content", 502);
  }
  const usage = json.usage
    ? {
        promptTokens: json.usage.prompt_tokens as number | undefined,
        completionTokens: json.usage.completion_tokens as number | undefined,
        totalTokens: json.usage.total_tokens as number | undefined,
      }
    : undefined;
  return {
    text: content,
    model: (json.model as string | undefined) ?? model,
    usage,
  };
};
