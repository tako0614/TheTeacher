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
  const targetTokens = options.targetTokens ?? 180;
  const maxTokens = options.maxTokens ?? 260;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\t+/g, " ").trim();
  if (!normalized) return [];

  const segments = normalized
    .split(/(?<=[。．.!?！？])\s+|\n{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean);

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

  const sourceSegments = segments.length > 0 ? segments : [normalized];

  for (const segment of sourceSegments) {
    const segmentTokens = countTokens(segment);
    const tentative = buffer ? `${buffer}\n${segment}` : segment;
    const tentativeTokens = bufferTokens + segmentTokens;

    if (buffer && tentativeTokens > maxTokens) {
      pushChunk();
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
): Promise<EmbeddingBatchResult> => {
  if (texts.length === 0) {
    return { embeddings: [], dimension: FALLBACK_EMBEDDING_DIMENSION, provider: "fallback" };
  }

  const apiKey = env?.OPENAI_API_KEY?.trim();
  const model =
    env?.OPENAI_EMBED_MODEL?.trim() ||
    env?.OPENAI_EMBEDDING_MODEL?.trim() ||
    DEFAULT_EMBEDDING_MODEL;
  if (!apiKey) {
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
): Promise<{
  chunks: MaterialChunkRecord[];
  dimension: number;
  provider: EmbeddingProvider;
  model?: string;
}> => {
  const { embeddings, dimension, provider, model } = await generateEmbeddings(
    chunks.map((chunk) => chunk.text),
    env,
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
