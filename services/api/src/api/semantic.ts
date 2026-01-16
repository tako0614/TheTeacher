import type { Prisma } from "@prisma/client/edge";
import type { D1Database } from "@cloudflare/workers-types";
import type { VectorizeVector, VectorizeVectorMetadata } from "@cloudflare/workers-types";
import type {
  GenerateFromMaterialRequest,
  GeneratedContent,
  Learning,
  Material,
  PracticeSession,
  SemanticNode,
} from "@theteacher/shared";

import {
  parseJson,
  type GeneratedContentRow,
  type MaterialRow,
  type PracticeSessionRow,
  type SemanticNodeRow,
} from "../db";
import { DEFAULT_USER_ID } from "../core/auth";
import { ensureCoreTables, getPrismaClient } from "../core/prisma";
import type { AppBindings } from "../core/types";
import { generateEmbeddings, toEmbedding, cosineSimilarity } from "./embeddings";
import { mapGeneratedContent, mapMaterial, mapPracticeSession } from "./data";
import { flattenContent, summarizeText } from "./utils";
import {
  asVectorizeBinding,
  deleteVectorizeByIds,
  ensureVectorDimensions,
  resolveExpectedVectorDimensions,
} from "./vectorize";

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

const ensureString = (value: unknown, fallback = "") => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return fallback;
};

const pickField = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    if (key in record) {
      const value = record[key];
      if (value !== undefined && value !== null) {
        return value;
      }
    }
  }
  return undefined;
};

export type SemanticNodeWithMeta = SemanticNode & {
  label: string;
  excerpt: string;
  subject?: string;
};

export type SemanticMatch = SemanticNodeWithMeta & {
  score: number;
  embedding: number[];
};

const generatedLabelMap: Record<GeneratedContent["type"], string> = {
  qa: "一問一答",
  practice: "練習問題",
  summary: "要約",
  podcast_script: "ポッドキャスト",
  other: "リッチノート",
};

const SEMANTIC_NODE_LIMIT = 600;

const encodeEmbedding = (vector: number[]): Uint8Array => {
  const rounded = vector.map((value) => Number(value.toFixed(6)));
  const view = new Float32Array(rounded);
  return new Uint8Array(view.buffer.slice(0));
};

const decodeEmbeddingValue = (raw: unknown): number[] | undefined => {
  if (!raw) return undefined;
  if (Array.isArray(raw)) {
    return raw.map((value) => Number(value) || 0);
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((value) => Number(value) || 0);
      }
    } catch {
      return undefined;
    }
  }
  if (raw instanceof ArrayBuffer) {
    return Array.from(new Float32Array(raw));
  }
  if (ArrayBuffer.isView(raw as ArrayBufferView)) {
    const view = raw as ArrayBufferView;
    return Array.from(
      new Float32Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)),
    );
  }
  return undefined;
};

interface SemanticNodeDraft {
  id?: string;
  userId: string;
  refType: SemanticNode["refType"];
  refId: string;
  embedding: number[];
  label: string;
  excerpt: string;
  subject?: string;
  metadata?: Record<string, unknown>;
}

type SemanticNodeDraftInput = Omit<SemanticNodeDraft, "embedding"> & { embeddingText: string };

const semanticNodeId = (refType: SemanticNode["refType"], refId: string) =>
  `${refType}:${refId}`;

const toSemanticNodeWithMeta = (
  draft: SemanticNodeDraft,
): SemanticNodeWithMeta & { embedding: number[] } => ({
  id: draft.id ?? semanticNodeId(draft.refType, draft.refId),
  userId: draft.userId,
  refType: draft.refType,
  refId: draft.refId,
  embedding: draft.embedding,
  metadata: draft.metadata,
  label: draft.label,
  excerpt: draft.excerpt,
  subject: draft.subject,
});

const toVectorizeMetadataValue = (value: unknown): VectorizeVectorMetadata | undefined => {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const next: Record<string, string | number | boolean | string[]> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
        next[key] = entry;
      } else if (Array.isArray(entry) && entry.every((item) => typeof item === "string")) {
        next[key] = entry;
      }
    }
    if (Object.keys(next).length > 0) return next;
  }
  return undefined;
};

const buildVectorizeVector = (draft: SemanticNodeDraft): VectorizeVector => {
  const id = draft.id ?? semanticNodeId(draft.refType, draft.refId);
  const metadata: Record<string, VectorizeVectorMetadata> = {
    kind: "semantic_node",
    userId: draft.userId,
    refType: draft.refType,
    refId: draft.refId,
    label: draft.label,
    excerpt: draft.excerpt,
    ...(draft.subject ? { subject: draft.subject } : {}),
  };
  const extra = toVectorizeMetadataValue(draft.metadata);
  if (extra && typeof extra === "object" && !Array.isArray(extra)) {
    metadata.extra = extra;
  }
  return { id, values: draft.embedding, metadata };
};

const upsertVectorizeNode = async (env: AppBindings | undefined, draft: SemanticNodeDraft) => {
  const vectorize = asVectorizeBinding(env?.VECTORIZE);
  if (!vectorize) return;
  const expected = resolveExpectedVectorDimensions(env);
  ensureVectorDimensions(draft.embedding, expected);
  await vectorize.upsert([buildVectorizeVector(draft)]);
};

const attachEmbeddingsToSemanticDrafts = async (
  drafts: SemanticNodeDraftInput[],
  env?: AppBindings,
): Promise<SemanticNodeDraft[]> => {
  if (drafts.length === 0) return [];
  const hasOpenAiKey = Boolean(env?.OPENAI_API_KEY?.trim());
  const allowFallback = !hasOpenAiKey;
  const { embeddings, dimension } = await generateEmbeddings(
    drafts.map((draft) => draft.embeddingText),
    env,
    { allowFallback },
  );
  return drafts.map((draft, index) => ({
    id: draft.id,
    userId: draft.userId,
    refType: draft.refType,
    refId: draft.refId,
    embedding: embeddings[index] ?? toEmbedding(draft.embeddingText, dimension),
    label: draft.label,
    excerpt: draft.excerpt,
    subject: draft.subject,
    metadata: draft.metadata,
  }));
};

const persistSemanticNode = async (
  db: D1Database | undefined,
  env: AppBindings | undefined,
  draft: SemanticNodeDraft,
) => {
  const id = draft.id ?? semanticNodeId(draft.refType, draft.refId);
  await upsertVectorizeNode(env, { ...draft, id });
  if (!db) return;
  await ensureCoreTables(db);
  const prisma = getPrismaClient(db);
  const metadata = {
    ...(draft.metadata ?? {}),
    label: draft.label,
    excerpt: draft.excerpt,
    subject: draft.subject ?? null,
  };
  await prisma.semanticNode.upsert({
    where: { id },
    create: {
      id,
      userId: draft.userId,
      refType: draft.refType,
      refId: draft.refId,
      embedding: encodeEmbedding(draft.embedding),
      metadata: metadata as unknown as Prisma.JsonValue,
    },
    update: {
      userId: draft.userId,
      refType: draft.refType,
      refId: draft.refId,
      embedding: encodeEmbedding(draft.embedding),
      metadata: metadata as unknown as Prisma.JsonValue,
    },
  });
};

const persistSemanticNodes = async (
  db: D1Database | undefined,
  env: AppBindings | undefined,
  drafts: SemanticNodeDraft[],
) => {
  if (drafts.length === 0) return;
  for (const draft of drafts) {
    await persistSemanticNode(db, env, draft);
  }
};

export const deleteSemanticNodesByRef = async (
  db: D1Database | undefined,
  env: AppBindings | undefined,
  refType: SemanticNode["refType"],
  refIds: string[],
  userId?: string,
) => {
  if (refIds.length === 0) return;
  const uniqueIds = Array.from(new Set(refIds));
  const vectorIds = uniqueIds.map((refId) => semanticNodeId(refType, refId));
  await deleteVectorizeByIds(env, vectorIds);
  if (!db) return;
  await ensureCoreTables(db);
  const prisma = getPrismaClient(db);
  await prisma.semanticNode.deleteMany({
    where: {
      refType,
      refId: { in: uniqueIds },
      ...(userId ? { userId } : {}),
    },
  });
};

const fallbackSemanticNodes = (userId: string = DEFAULT_USER_ID): (SemanticNodeWithMeta & { embedding: number[] })[] =>
  [
    {
      id: "fallback-learning",
      userId,
      refType: "learning" as const,
      refId: "fallback-learning",
      embedding: toEmbedding("高校数学 二次関数 基礎練習"),
      metadata: { tags: ["math"] },
      label: "高校数学I: 二次関数",
      excerpt: "二次関数の基本変換と判別式を確認する練習セット",
      subject: "math",
    },
  ].map((node) => ({ ...node, embedding: node.embedding.slice() }));

const mapSemanticRowToNode = (
  row: SemanticNodeRow,
): (SemanticNodeWithMeta & { embedding: number[] }) | null => {
  const embedding = decodeEmbeddingValue(row.embedding);
  if (!embedding || embedding.length === 0) return null;
  const metadata =
    typeof row.metadata === "string"
      ? parseJson<Record<string, unknown>>(row.metadata)
      : ((row.metadata as unknown as Record<string, unknown>) ?? undefined);
  const label =
    typeof metadata?.label === "string"
      ? metadata.label
      : `${row.refType.toUpperCase()}: ${row.refId.slice(0, 8)}`;
  const excerpt = typeof metadata?.excerpt === "string" ? metadata.excerpt : label;
  const subject =
    typeof metadata?.subject === "string" && metadata.subject.length > 0
      ? metadata.subject
      : undefined;
  return {
    id: row.id,
    userId: row.userId,
    refType: row.refType,
    refId: row.refId,
    embedding,
    metadata,
    label,
    excerpt,
    subject,
  };
};

const loadSemanticNodesFromDb = async (
  db: D1Database,
  userId: string,
): Promise<(SemanticNodeWithMeta & { embedding: number[] })[]> => {
  const prisma = getPrismaClient(db);
  const rows = await prisma.semanticNode.findMany({
    where: { userId },
    orderBy: { id: "desc" },
    take: SEMANTIC_NODE_LIMIT,
  });
  return rows
    .map((row) => mapSemanticRowToNode(row as unknown as SemanticNodeRow))
    .filter((node): node is SemanticNodeWithMeta & { embedding: number[] } => Boolean(node));
};

const buildLearningEmbeddingBasis = (
  learning: Pick<Learning, "title" | "subject" | "tags">,
) => {
  const tags = learning.tags ?? [];
  const basis = `${learning.title} ${learning.subject ?? ""} ${tags.join(" ")}`.trim();
  return { basis, tags };
};

const buildLearningSemanticDraft = (
  learning: Pick<Learning, "id" | "title" | "subject" | "tags">,
): SemanticNodeDraftInput => {
  const { basis, tags } = buildLearningEmbeddingBasis(learning);
  return {
    refType: "learning",
    refId: learning.id,
    embeddingText: basis,
    label: learning.title,
    excerpt: summarizeText(basis, 120),
    subject: learning.subject ?? undefined,
    metadata: { tags },
  };
};

const buildMaterialEmbeddingBasis = (material: Material) =>
  `${material.type} ${material.rawContent ?? material.sourcePath ?? material.type ?? ""}`;

const buildMaterialSemanticDraft = (
  material: Material,
  subject?: string,
): SemanticNodeDraftInput => {
  const body = material.rawContent ?? material.sourcePath ?? material.type;
  return {
    refType: "material",
    refId: material.id,
    embeddingText: buildMaterialEmbeddingBasis(material),
    label: `${material.type.toUpperCase()}: ${summarizeText(
      material.sourcePath ?? material.rawContent ?? "material",
      48,
    )}`,
    excerpt: summarizeText(body ?? material.type, 160),
    subject,
    metadata: {
      ...(material.metadata ?? {}),
      learningId: material.learningId,
      type: material.type,
    },
  };
};

const buildGeneratedContentSemanticDraft = (
  content: GeneratedContent,
  subject?: string,
): SemanticNodeDraftInput => {
  const body = flattenContent(content.content);
  return {
    refType: "generated_content",
    refId: content.id,
    embeddingText: `${content.type} ${body}`,
    label: `${generatedLabelMap[content.type] ?? content.type}: ${summarizeText(body, 48)}`,
    excerpt: summarizeText(body, 160),
    subject,
    metadata: {
      promptPreset: content.promptPreset,
      materialId: content.materialId,
      learningId: content.learningId,
      type: content.type,
    },
  };
};

const normalizeQuestionRef = (value?: Record<string, unknown>) => {
  const record = asRecord(value);
  if (!record) return {};
  const toOptionalString = (input: unknown): string | undefined => {
    const text = ensureString(input);
    return text.length ? text : undefined;
  };
  return {
    prompt: toOptionalString(pickField(record, ["prompt", "question", "body", "text"])),
    expected: toOptionalString(
      pickField(record, ["expected", "expectedAnswer", "answer", "solution"]),
    ),
    hint: toOptionalString(pickField(record, ["hint", "explanation", "note", "rationale"])),
    title: toOptionalString(pickField(record, ["title", "name", "label"])),
    subject: toOptionalString(pickField(record, ["subject", "course"])),
  };
};

const buildPracticeQuestionSemanticDraft = (
  session: PracticeSession,
  subject?: string,
): SemanticNodeDraftInput => {
  const question = normalizeQuestionRef(session.questionRef);
  const excerptSource =
    question.prompt ?? question.expected ?? question.hint ?? session.answerText ?? "演習問題";
  const label =
    question.title ?? summarizeText(question.prompt ?? excerptSource ?? "演習問題", 48) ?? "演習問題";
  const embeddingParts = [
    label,
    question.prompt,
    question.expected,
    question.hint,
    session.answerText,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const embeddingText = embeddingParts.join(" ").trim() || "演習問題";

  return {
    refType: "question",
    refId: session.id,
    embeddingText,
    label,
    excerpt: summarizeText(excerptSource, 160),
    subject: question.subject ?? subject,
    metadata: {
      learningId: session.learningId,
      generatedContentId: session.generatedContentId,
      expected: question.expected,
      hint: question.hint,
      title: question.title,
      prompt: question.prompt,
      answerPreview: session.answerText ? summarizeText(session.answerText, 96) : undefined,
      score: session.score,
      isCorrect: session.isCorrect,
    },
  };
};

export const indexLearningSemanticNode = async (
  db: D1Database | undefined,
  env: AppBindings | undefined,
  learning: Pick<Learning, "id" | "title" | "subject" | "tags" | "userId">,
) => {
  const drafts = await attachEmbeddingsToSemanticDrafts(
    [{ ...buildLearningSemanticDraft(learning), userId: learning.userId }],
    env,
  );
  if (drafts[0]) {
    await persistSemanticNode(db, env, drafts[0]);
  }
};

export const indexMaterialSemanticNode = async (
  db: D1Database | undefined,
  env: AppBindings | undefined,
  material: Material,
  subject?: string,
) => {
  const drafts = await attachEmbeddingsToSemanticDrafts(
    [{ ...buildMaterialSemanticDraft(material, subject), userId: material.userId }],
    env,
  );
  if (drafts[0]) {
    await persistSemanticNode(db, env, drafts[0]);
  }
};

export const indexGeneratedContentSemanticNode = async (
  db: D1Database | undefined,
  env: AppBindings | undefined,
  content: GeneratedContent,
  subject?: string,
) => {
  const drafts = await attachEmbeddingsToSemanticDrafts(
    [{ ...buildGeneratedContentSemanticDraft(content, subject), userId: content.userId }],
    env,
  );
  if (drafts[0]) {
    await persistSemanticNode(db, env, drafts[0]);
  }
};

export const indexPracticeQuestionSemanticNode = async (
  db: D1Database | undefined,
  env: AppBindings | undefined,
  session: PracticeSession,
  subject?: string,
) => {
  const drafts = await attachEmbeddingsToSemanticDrafts(
    [{ ...buildPracticeQuestionSemanticDraft(session, subject), userId: session.userId }],
    env,
  );
  if (drafts[0]) {
    await persistSemanticNode(db, env, drafts[0]);
  }
};

const buildSemanticNodesFromSourceTables = async (
  db: D1Database,
  userId: string,
  env?: AppBindings,
): Promise<(SemanticNodeWithMeta & { embedding: number[] })[]> => {
  const prisma = getPrismaClient(db);
  const learningRows = await prisma.learning.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { id: true, title: true, subject: true, tags: true },
  });
  const learnings = learningRows.map((row) => ({
    id: row.id,
    title: row.title,
    subject: row.subject ?? undefined,
    tags:
      row.tags && typeof row.tags === "string"
        ? parseJson<string[]>(row.tags) ?? []
        : (row.tags as unknown as string[] | undefined) ?? [],
  }));
  const drafts: SemanticNodeDraftInput[] = learnings.map((learning) => ({
    ...buildLearningSemanticDraft(learning),
    userId,
  }));
  const learningSubjectMap = new Map(learnings.map((item) => [item.id, item.subject]));

  const materialRows = await prisma.material.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  for (const row of materialRows ?? []) {
    const material = mapMaterial(row as unknown as MaterialRow);
    drafts.push({
      ...buildMaterialSemanticDraft(material, learningSubjectMap.get(material.learningId)),
      userId,
    });
  }

  const contentRows = await prisma.generatedContent.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  for (const row of contentRows ?? []) {
    const content = mapGeneratedContent(row as unknown as GeneratedContentRow);
    drafts.push({
      ...buildGeneratedContentSemanticDraft(content, learningSubjectMap.get(content.learningId)),
      userId,
    });
  }

  const practiceRows = await prisma.practiceSession.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  for (const row of practiceRows ?? []) {
    const session = mapPracticeSession(row as unknown as PracticeSessionRow);
    drafts.push({
      ...buildPracticeQuestionSemanticDraft(
        session,
        learningSubjectMap.get(session.learningId),
      ),
      userId,
    });
  }

  const embedded = await attachEmbeddingsToSemanticDrafts(drafts, env);
  return embedded.map((draft) => toSemanticNodeWithMeta(draft));
};

export const fallbackLearnings: (Learning & {
  materialsCount: number;
  generatedCount: number;
  sessionCount: number;
})[] = [
  {
    id: "fallback-learning",
    title: "高校数学I_二次関数_第1回",
    subject: "math",
    tags: ["demo", "math"],
    progress: 0.2,
    createdAt: "2024-11-01T00:00:00.000Z",
    updatedAt: "2024-11-03T00:00:00.000Z",
    materialsCount: 2,
    generatedCount: 3,
    sessionCount: 5,
  },
];

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (value: string | undefined | null): value is string =>
  !!value && uuidPattern.test(value);

const subjectKeywordHints = [
  {
    subject: "math",
    label: "数学",
    keywords: [/数学/, /算数/, /方程式/, /関数/, /geometry/i],
  },
  {
    subject: "english",
    label: "英語",
    keywords: [/英語/, /english/i, /toeic/i, /toefl/i, /ielts/i],
  },
  {
    subject: "science",
    label: "理科",
    keywords: [/理科/, /science/i, /化学/, /physics/i, /生物/],
  },
  {
    subject: "japanese",
    label: "国語",
    keywords: [/国語/, /現代文/, /古文/, /作文/, /文章力/],
  },
  {
    subject: "social",
    label: "社会",
    keywords: [/歴史/, /地理/, /公民/, /社会/, /civics/i],
  },
  {
    subject: "programming",
    label: "プログラミング",
    keywords: [/プログラミング/, /coding/i, /アルゴリズム/, /javascript/i],
  },
] as const;

type SubjectHint = (typeof subjectKeywordHints)[number]["subject"];

export const subjectLabelMap: Record<string, string> = subjectKeywordHints.reduce(
  (acc, item) => {
    acc[item.subject] = item.label;
    return acc;
  },
  {} as Record<string, string>,
);

export const detectSubjectFromPrompt = (prompt: string): SubjectHint | undefined => {
  for (const hint of subjectKeywordHints) {
    if (hint.keywords.some((keyword) => keyword.test(prompt))) {
      return hint.subject;
    }
  }
  return undefined;
};

const containsKeyword = (value: string, patterns: RegExp[]) =>
  patterns.some((pattern) => pattern.test(value));

const creationKeywords = [
  /新しい学習/,
  /新規学習/,
  /教材を作/,
  /作って/,
  /作成して/,
  /生成して/,
  /build/i,
  /create/i,
  /generate/i,
];

const questionKeywords = [/問題/, /テスト/, /quiz/i, /演習/, /drill/i, /practice/i];
const qaKeywords = [/一問一答/, /qa/i, /質問集/];
const summaryKeywords = [/要約/, /まとめ/, /サマリ/, /振り返り/];
const podcastKeywords = [/ポッドキャスト/, /podcast/i, /スクリプト/];

export const shouldCreateLearningFromPrompt = (prompt: string, matches: SemanticMatch[]) => {
  if (containsKeyword(prompt, creationKeywords)) {
    return true;
  }
  if (matches.length === 0) {
    return true;
  }
  const topScore = matches[0]?.score ?? 0;
  return topScore < 0.35;
};

export const determineGenerationTypes = (
  prompt: string,
): GenerateFromMaterialRequest["types"] => {
  const next = new Set<GenerateFromMaterialRequest["types"][number]>();
  if (containsKeyword(prompt, questionKeywords)) next.add("practice");
  if (containsKeyword(prompt, qaKeywords)) next.add("qa");
  if (containsKeyword(prompt, summaryKeywords)) next.add("summary");
  if (containsKeyword(prompt, podcastKeywords)) next.add("podcast_script");
  return Array.from(next);
};

export const buildLearningTitleFromPrompt = (prompt: string, subject?: SubjectHint) => {
  const trimmed = prompt.replace(/\s+/g, " ").trim();
  const base = trimmed.slice(0, 32) || "チャット提案プラン";
  if (!subject) return base;
  const label = subjectLabelMap[subject] ?? subject;
  return `${label}: ${base}`;
};

export const buildLearningTagsFromPrompt = (prompt: string, subject?: SubjectHint) => {
  const tags = new Set<string>();
  if (subject) tags.add(subject);
  if (/toeic/i.test(prompt)) tags.add("toeic");
  if (/eiken/i.test(prompt)) tags.add("eiken");
  tags.add("ai-chat");
  return Array.from(tags);
};

const buildSemanticIndex = async (
  db: D1Database | undefined,
  env: AppBindings | undefined,
  userId: string,
): Promise<(SemanticNodeWithMeta & { embedding: number[] })[]> => {
  if (!db) return fallbackSemanticNodes(userId);
  const stored = await loadSemanticNodesFromDb(db, userId);
  if (stored.length > 0) {
    return stored;
  }
  const regenerated = await buildSemanticNodesFromSourceTables(db, userId, env);
  if (regenerated.length > 0) {
    await persistSemanticNodes(
      db,
      env,
      regenerated.map(
        (node): SemanticNodeDraft => ({
          id: node.id,
          userId: node.userId ?? userId,
          refType: node.refType,
          refId: node.refId,
          embedding: node.embedding.slice(),
          label: node.label,
          excerpt: node.excerpt,
          subject: node.subject,
          metadata: (node.metadata as Record<string, unknown> | undefined) ?? undefined,
        }),
      ),
    );
    return regenerated.map((node) => ({ ...node, userId }));
  }
  return fallbackSemanticNodes(userId);
};

const vectorizeMetadataString = (metadata: Record<string, VectorizeVectorMetadata> | undefined, key: string) => {
  const value = metadata?.[key];
  if (typeof value === "string") return value;
  return undefined;
};

const vectorizeMetadataRefType = (metadata: Record<string, VectorizeVectorMetadata> | undefined) => {
  const value = metadata?.refType;
  if (value === "learning" || value === "material" || value === "generated_content" || value === "question") {
    return value;
  }
  return undefined;
};

const searchSemanticWithVectorize = async (
  env: AppBindings,
  queryVector: number[],
  topK: number,
  filters: Partial<Pick<SemanticNodeWithMeta, "refType" | "subject">> | undefined,
  userId: string,
): Promise<SemanticMatch[]> => {
  const vectorize = asVectorizeBinding(env.VECTORIZE);
  if (!vectorize) return [];
  const expected = resolveExpectedVectorDimensions(env);
  ensureVectorDimensions(queryVector, expected);

  const filter: Record<string, unknown> = { kind: "semantic_node", userId };
  if (filters?.refType) filter.refType = filters.refType;
  if (filters?.subject) filter.subject = filters.subject;

  const result = await vectorize.query(queryVector, {
    topK,
    returnValues: true,
    returnMetadata: "all",
    filter: filter as never,
  });

  return (result.matches ?? [])
    .map((match) => {
      const metadata = match.metadata as Record<string, VectorizeVectorMetadata> | undefined;
      const label = vectorizeMetadataString(metadata, "label") ?? match.id;
      const excerpt = vectorizeMetadataString(metadata, "excerpt") ?? "";
      const subject = vectorizeMetadataString(metadata, "subject");
      const refType = vectorizeMetadataRefType(metadata);
      const refId = vectorizeMetadataString(metadata, "refId") ?? match.id;
      const embedding = Array.isArray(match.values) ? match.values.map((v) => Number(v) || 0) : [];
      if (!refType) return null;
      return {
        id: match.id,
        userId,
        refType,
        refId,
        label,
        excerpt,
        subject,
        metadata: undefined,
        score: Number(match.score ?? 0),
        embedding,
      } satisfies SemanticMatch;
    })
    .filter((value): value is SemanticMatch => Boolean(value))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
};

export const searchSemantic = async (
  db: D1Database | undefined,
  env: AppBindings | undefined,
  query: string,
  topK: number,
  filters?: Partial<Pick<SemanticNodeWithMeta, "refType" | "subject">>,
  userId: string = DEFAULT_USER_ID,
): Promise<SemanticMatch[]> => {
  const hasOpenAiKey = Boolean(env?.OPENAI_API_KEY?.trim());
  const vectorizeEnabled = Boolean(env?.VECTORIZE && hasOpenAiKey);

  if (env && vectorizeEnabled) {
    try {
      const { embeddings: queryEmbeddings, dimension } = await generateEmbeddings([query], env, {
        allowFallback: false,
      });
      const queryVector = queryEmbeddings[0] ?? toEmbedding(query, dimension);
      const matches = await searchSemanticWithVectorize(env, queryVector, topK, filters, userId);
      if (matches.length > 0) return matches;
    } catch (error) {
      console.warn("Vectorize semantic search failed; falling back to D1 scan", error);
    }
  }

  const index = await buildSemanticIndex(db, env, userId);
  const allowFallback = !hasOpenAiKey;
  const { embeddings: queryEmbeddings, dimension } = await generateEmbeddings([query], env, { allowFallback });
  const queryVector = queryEmbeddings[0] ?? toEmbedding(query, dimension);

  const matches = index
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

export const syncSemanticIndexToVectorize = async (
  db: D1Database | undefined,
  env: AppBindings | undefined,
  userId: string,
): Promise<{ upserted: number }> => {
  const vectorize = asVectorizeBinding(env?.VECTORIZE);
  if (!vectorize) return { upserted: 0 };
  if (!env?.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is required to sync Vectorize index");
  }
  const expected = resolveExpectedVectorDimensions(env);
  const nodes = await buildSemanticIndex(db, env, userId);
  const vectors = nodes.map((node) => {
    ensureVectorDimensions(node.embedding, expected);
    return buildVectorizeVector({
      id: node.id,
      userId,
      refType: node.refType,
      refId: node.refId,
      embedding: node.embedding,
      label: node.label,
      excerpt: node.excerpt,
      subject: node.subject,
      metadata: (node.metadata as Record<string, unknown> | undefined) ?? undefined,
    });
  });

  const batchSize = 50;
  for (let i = 0; i < vectors.length; i += batchSize) {
    await vectorize.upsert(vectors.slice(i, i + batchSize));
  }
  return { upserted: vectors.length };
};

export type SerializedMatch = Pick<SemanticMatch, "id" | "label" | "excerpt" | "score" | "refType" | "subject">;

export const serializeMatchesForClient = (matches: SemanticMatch[]): SerializedMatch[] =>
  matches.map((match) => ({
    id: match.id,
    label: match.label,
    excerpt: match.excerpt,
    score: Number(match.score ?? 0),
    refType: match.refType,
    subject: match.subject,
  }));

export const describeRelatedBrief = (related: SerializedMatch[]) => {
  if (related.length === 0) return "関連候補はありませんでした。";
  return related
    .slice(0, 3)
    .map((match, index) => {
      const subjectLabel = match.subject ? subjectLabelMap[match.subject] ?? match.subject : undefined;
      const subjectText = subjectLabel ? ` / ${subjectLabel}` : "";
      return `${index + 1}. ${match.label} (score ${match.score.toFixed(2)}${subjectText})`;
    })
    .join("\n");
};
