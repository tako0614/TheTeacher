import {
  schemas,
  type SemanticNode,
  refTypeSchema,
} from "@theteacher/shared";
import { Hono } from "hono";
import { z } from "zod";

const proxyRequestSchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
  model: z.string().default("gpt-4o-mini"),
  topK: z.number().int().min(1).max(10).default(3).optional(),
});

const embedRequestSchema = z.object({
  texts: z.array(z.string().min(1)).min(1),
});

const semanticSearchRequestSchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().min(1).max(10).default(5),
  refType: refTypeSchema.optional(),
  subject: z.string().min(1).optional(),
});

export const app = new Hono();

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

type SemanticNodeWithMeta = SemanticNode & {
  label: string;
  excerpt: string;
  subject?: string;
};

type SemanticMatch = SemanticNodeWithMeta & {
  score: number;
  embedding: number[];
};

const EMBEDDING_DIMENSION = 12;

const toEmbedding = (text: string): number[] => {
  const vec = Array.from({ length: EMBEDDING_DIMENSION }, () => 0);
  for (let i = 0; i < text.length; i++) {
    const bucket = i % EMBEDDING_DIMENSION;
    vec[bucket] += text.charCodeAt(i) % 31;
  }
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value ** 2, 0)) || 1;
  return vec.map((value) => Number((value / norm).toFixed(4)));
};

const semanticIndex: Array<SemanticNodeWithMeta & { embedding: number[] }> = [
  {
    id: "9c7c99b2-afe1-469e-8c22-1b8d566c6a30",
    refType: "learning",
    refId: "8e3dfdc0-5510-4c12-9f60-7cba439b1dea",
    embedding: toEmbedding("二次関数 頂点 平方完成 例題3"),
    metadata: { tags: ["二次関数", "基礎"], level: "highschool" },
    label: "高校数学I: 二次関数",
    excerpt:
      "二次関数の平方完成、軸・頂点の求め方、判別式の確認をまとめた教材",
    subject: "math",
  },
  {
    id: "532bcb3a-1fde-4cf7-8f9a-98e36f257a61",
    refType: "generated_content",
    refId: "18b33a10-8528-4e53-8b1b-717f27a5a2c3",
    embedding: toEmbedding("QA 頂点 最小値 チェック問題 集合"),
    metadata: { tags: ["qa", "practice"] },
    label: "平方完成チェック (Q&A)",
    excerpt:
      "f(x)=x^2+4x+5 の頂点と最小値を確認する短答式の問題セット。復習用。",
    subject: "math",
  },
  {
    id: "012f84a1-4f46-4aa1-8c56-288c8f146abe",
    refType: "learning",
    refId: "63a8e91f-1c40-4d73-8d8e-3a690c1da0e7",
    embedding: toEmbedding("英語 長文 時制の一致 演習"),
    metadata: { tags: ["english", "grammar"] },
    label: "英語長文: 時制の一致",
    excerpt: "時制の一致を題材にした英語長文読解。演習問題と要約付き。",
    subject: "english",
  },
  {
    id: "21b4f5fa-5f8b-44c7-ae34-61e07cf1b8e4",
    refType: "generated_content",
    refId: "86a9ffd4-5b10-4f17-9f6d-017fbd7edc5c",
    embedding: toEmbedding("計算セット 軸 頂点 判別式 練習問題"),
    metadata: { tags: ["practice", "math"] },
    label: "基本計算セット (練習問題)",
    excerpt: "軸と頂点、判別式の扱いを含む3問セット。復習モードに最適。",
    subject: "math",
  },
  {
    id: "e2a6e9e8-37c1-4f84-813e-207e6aa7e5a4",
    refType: "generated_content",
    refId: "b7e3a736-6e0f-4dfd-9fb0-1b5e26563185",
    embedding: toEmbedding("時制の一致 Q&A 短答セット"),
    metadata: { tags: ["qa", "english"] },
    label: "時制の一致Q&A",
    excerpt: "時制の一致を判断する短答式セット。用法の例文と解説付き。",
    subject: "english",
  },
];

const cosineSimilarity = (a: number[], b: number[]): number => {
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

const searchSemantic = (
  query: string,
  topK: number,
  filters?: Partial<Pick<SemanticNodeWithMeta, "refType" | "subject">>,
): SemanticMatch[] => {
  const queryVector = toEmbedding(query);
  const matches = semanticIndex
    .filter((node) => {
      if (filters?.refType && node.refType !== filters.refType) return false;
      if (filters?.subject && node.subject !== filters.subject) return false;
      return true;
    })
    .map((node) => ({
      ...node,
      score: cosineSimilarity(queryVector, node.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return matches.map((match) => ({
    ...match,
    embedding: match.embedding.slice(),
  }));
};

app.post("/ai/embed", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = embedRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const embeddings = parsed.data.texts.map((text) => toEmbedding(text));
  return c.json({
    dimension: EMBEDDING_DIMENSION,
    embeddings,
  });
});

app.post("/search/semantic", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = semanticSearchRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const { query, topK, refType, subject } = parsed.data;
  const results = searchSemantic(query, topK, { refType, subject });

  return c.json({ query, topK, results });
});

app.post("/ai/proxy", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = proxyRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        error: "invalid_request",
        issues: parsed.error.format(),
      },
      400,
    );
  }

  const topK = parsed.data.topK ?? 3;
  const related = searchSemantic(parsed.data.prompt, topK);
  const toolCalls = [
    {
      tool: "embed",
      detail: `texts=1 dim=${EMBEDDING_DIMENSION}`,
    },
    {
      tool: "semantic_search",
      detail: `query="${parsed.data.prompt.slice(0, 32)}" topK=${topK}`,
      result: related[0]
        ? `${related[0].label} (score ${related[0].score})`
        : "no match",
    },
  ];

  const summary =
    related.length === 0
      ? "近い教材が見つかりませんでしたが、新しいコンテンツを提案できます。"
      : `関連の候補として「${related[0].label}」などが見つかりました。続けますか？`;

  return c.json({
    message: summary,
    request: parsed.data,
    exampleSchema: {
      learning: schemas.learning.keyof().options,
    },
    related,
    toolCalls,
  });
});

export default app;
