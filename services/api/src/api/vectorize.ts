import type { Vectorize, VectorizeIndex } from "@cloudflare/workers-types";

import type { AppBindings } from "../core/types";

export type VectorizeBinding = Vectorize | VectorizeIndex;

export const asVectorizeBinding = (value: unknown): VectorizeBinding | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<Vectorize>;
  if (typeof candidate.query === "function" && typeof candidate.upsert === "function") {
    return value as VectorizeBinding;
  }
  return undefined;
};

export const resolveExpectedVectorDimensions = (env?: AppBindings): number | undefined => {
  const raw = env?.VECTORIZE_INDEX_DIMENSIONS;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.trunc(raw);
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
  }
  return undefined;
};

export const ensureVectorDimensions = (vector: number[], expected?: number) => {
  if (!expected) return;
  if (vector.length !== expected) {
    throw new Error(
      `Vector dimension mismatch (got ${vector.length}, expected ${expected}). Ensure the Vectorize index dimensions match OPENAI_EMBEDDING_MODEL.`,
    );
  }
};

export const deleteVectorizeByIds = async (env: AppBindings | undefined, ids: string[]) => {
  const vectorize = asVectorizeBinding(env?.VECTORIZE);
  if (!vectorize || ids.length === 0) return;
  const unique = Array.from(new Set(ids));
  await vectorize.deleteByIds(unique);
};

