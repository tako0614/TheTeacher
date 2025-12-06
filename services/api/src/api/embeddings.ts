import type { AppBindings } from "../core/types";
import { resolveOpenAiBaseUrl } from "./openai";
import { countTokens, summarizeText } from "./utils";

export interface MaterialChunkRecord {
  id: string;
  order: number;
  text: string;
  tokens: number;
  preview: string;
  embedding?: number[];
}

export const chunkMaterialText = (
  text: string,
  options: { targetTokens?: number; maxTokens?: number } = {},
): MaterialChunkRecord[] => {
  const targetTokens = options.targetTokens ?? 240; // Increased slightly for Markdown
  const maxTokens = options.maxTokens ?? 480;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\t+/g, " ").trim();
  if (!normalized) return [];

  // Markdown Header-aware splitting
  // Split by headers (#, ##, ###) but keep the delimiter to attach it to the following content
  // Also split by double newlines to respect paragraphs
  const headerRegex = /(^|\n)(#{1,6}\s+[^\n]+)/;
  const segments = normalized
    .split(headerRegex)
    .reduce((acc, curr, index, array) => {
      // Re-attach header delimiter if it was split
      // split with capture group returns [pre, capture, post, ...]
      // We want to merge capture (header) with the following text block
      if (curr.trim() === "") return acc;
      
      // If current segment matches header pattern (it was the capture group)
      if (/^[\n]?(#{1,6}\s+[^\n]+)/.test(curr)) {
         acc.push(curr.trim());
      } else {
         // It's a body content
         // Check if the previous item in acc was a header
         const prev = acc[acc.length - 1];
         if (prev && /^#{1,6}\s+[^\n]+$/.test(prev)) {
             // Merge with previous header
             acc[acc.length - 1] = prev + "\n\n" + curr.trim();
         } else {
             // Just a loose paragraph (or start of file without header)
             // Further split purely by paragraphs if it's too long? 
             // For now, just push it.
             acc.push(curr.trim());
         }
      }
      return acc;
    }, [] as string[])
    // Further split very long segments if they exceed token limits (simplified)
    .flatMap((seg) => {
      const tokens = countTokens(seg);
      if (tokens > maxTokens) {
        const sentenceSegments = seg
          .split(/(?<=[.!?])\s+/)
          .map((entry) => entry.trim())
          .filter(Boolean);
        if (sentenceSegments.length > 1) {
          return sentenceSegments;
        }
        return seg
          .split(/\n{2,}/)
          .map((s) => s.trim())
          .filter(Boolean);
      }
      return [seg];
    });

  const chunks: MaterialChunkRecord[] = [];
  let buffer = "";
  let bufferTokens = 0;

  const pushChunk = () => {
    const trimmed = buffer.trim();
    if (!trimmed) return;
    chunks.push({
      id: crypto.randomUUID(),
      order: chunks.length,
      text: trimmed,
      tokens: countTokens(trimmed),
      preview: summarizeText(trimmed, 160),
    });
    buffer = "";
    bufferTokens = 0;
  };

  for (const segment of segments) {
    const segmentTokens = countTokens(segment);
    const tentative = buffer ? `${buffer}\n\n${segment}` : segment;
    const tentativeTokens = bufferTokens + segmentTokens;

    if (buffer && tentativeTokens > maxTokens) {
      pushChunk();
      // If the single segment itself is huge, we have to push it alone (it was already split by para above if possible)
      buffer = segment;
      bufferTokens = segmentTokens;
      continue;
    }

    buffer = tentative;
    bufferTokens = tentativeTokens;

    if (bufferTokens >= targetTokens) {
      pushChunk();
    }
  }

  if (buffer.trim()) {
    pushChunk();
  }

  if (chunks.length === 0) {
    chunks.push({
      id: crypto.randomUUID(),
      order: 0,
      text: normalized,
      tokens: countTokens(normalized),
      preview: summarizeText(normalized, 160),
    });
  }

  return chunks;
};

const FALLBACK_EMBEDDING_DIMENSION = 12;
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

type EmbeddingProvider = "openai" | "fallback";

interface EmbeddingBatchResult {
  embeddings: number[][];
  dimension: number;
  model?: string;
  provider: EmbeddingProvider;
}

export interface GenerateEmbeddingsOptions {
  allowFallback?: boolean;
}

export const toEmbedding = (text: string, dimension = FALLBACK_EMBEDDING_DIMENSION): number[] => {
  const vec = Array.from({ length: dimension }, () => 0);
  for (let i = 0; i < text.length; i++) {
    const bucket = i % dimension;
    vec[bucket] += text.charCodeAt(i) % 31;
  }
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value ** 2, 0)) || 1;
  return vec.map((value) => Number((value / norm).toFixed(4)));
};

export const normalizeEmbeddingVector = (vector: unknown): number[] => {
  if (!Array.isArray(vector)) return [];
  return vector.map((value) => Number(value) || 0);
};

export const generateEmbeddings = async (
  texts: string[],
  env?: AppBindings,
  options?: GenerateEmbeddingsOptions,
): Promise<EmbeddingBatchResult> => {
  const allowFallback = options?.allowFallback ?? true;
  if (texts.length === 0) {
    return { embeddings: [], dimension: FALLBACK_EMBEDDING_DIMENSION, provider: "fallback" };
  }

  const apiKey = env?.OPENAI_API_KEY?.trim();
  const model =
    env?.OPENAI_EMBED_MODEL?.trim() ||
    env?.OPENAI_EMBEDDING_MODEL?.trim() ||
    DEFAULT_EMBEDDING_MODEL;
  if (!apiKey) {
    if (!allowFallback) {
      throw new Error("OPENAI_API_KEY is required to generate embeddings");
    }
    return {
      embeddings: texts.map((text) => toEmbedding(text)),
      dimension: FALLBACK_EMBEDDING_DIMENSION,
      provider: "fallback",
    };
  }

  try {
    const response = await fetch(`${resolveOpenAiBaseUrl(env)}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: texts,
        model,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`OpenAI embedding request failed (${response.status}): ${detail}`);
    }
    const json = (await response.json()) as { data?: { embedding?: number[] }[]; model?: string };
    const vectors = (json.data ?? []).map((item) => normalizeEmbeddingVector(item.embedding));
    if (!vectors.length || vectors.some((vec) => vec.length === 0)) {
      throw new Error("OpenAI embedding response did not contain valid vectors");
    }
    const dimension = vectors[0].length;
    return {
      embeddings: vectors,
      dimension,
      model: json.model ?? model,
      provider: "openai",
    };
  } catch (error) {
    console.warn("embedding generation failed, falling back", error);
    if (!allowFallback) {
      throw error instanceof Error
        ? error
        : new Error("OpenAI embedding request failed without fallback");
    }
    return {
      embeddings: texts.map((text) => toEmbedding(text)),
      dimension: FALLBACK_EMBEDDING_DIMENSION,
      provider: "fallback",
    };
  }
};

export const cosineSimilarity = (a: number[], b: number[]): number => {
  const dim = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < dim; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (!Number.isFinite(denom) || denom === 0) return 0;
  return Number((dot / denom).toFixed(4));
};

export const attachEmbeddingsToChunks = async (
  chunks: MaterialChunkRecord[],
  env?: AppBindings,
  options?: GenerateEmbeddingsOptions,
): Promise<{
  chunks: MaterialChunkRecord[];
  dimension: number;
  provider: EmbeddingProvider;
  model?: string;
}> => {
  const hasOpenAiKey = Boolean(env?.OPENAI_API_KEY?.trim());
  const allowFallback = options?.allowFallback ?? !hasOpenAiKey;
  const { embeddings, dimension, provider, model } = await generateEmbeddings(
    chunks.map((chunk) => chunk.text),
    env,
    { allowFallback },
  );
  return {
    chunks: chunks.map((chunk, index) => ({
      ...chunk,
      embedding: embeddings[index] ?? toEmbedding(chunk.text, dimension),
    })),
    dimension,
    provider,
    model,
  };
};
