import type { GeneratedContentType } from "@theteacher/shared";

import { requestJson } from "./http";

export type ToolCallLog = {
  tool: string;
  detail: string;
  result?: string;
};

export type SemanticMatch = {
  id: string;
  label: string;
  excerpt: string;
  score: number;
  refType: string;
  refId?: string;
  subject?: string;
};

export type SemanticSearchOptions = {
  refType?: string;
  subject?: string;
};

export type GeneratedSummary = {
  id: string;
  type: GeneratedContentType;
  title: string;
  learningId?: string;
  learningTitle?: string;
};

export type ProxyActions = {
  createdLearningId?: string;
  createdLearningTitle?: string;
  createdLearningSubject?: string;
  createdLearningReason?: string;
  generatedContentSummaries?: GeneratedSummary[];
};

export type ChatReply = {
  reply: string;
  toolCalls: ToolCallLog[];
  related: SemanticMatch[];
  intent?: "search" | "create_learning" | "generate_content";
  actions?: ProxyActions;
};

export type ToolName =
  | "search_learnings"
  | "create_learning_from_chat"
  | "generate_questions"
  | "save_content";

export type ToolInvocation = {
  tool: ToolName;
  result: unknown;
};

const fallbackMatches: SemanticMatch[] = [
  {
    id: "local-1",
    label: "高校数学I: 二次関数",
    excerpt: "平方完成と軸・頂点の求め方をまとめた教材サマリ。",
    score: 0.85,
    refType: "learning",
    subject: "math",
    refId: "local-1",
  },
  {
    id: "local-2",
    label: "基本計算セット (練習問題)",
    excerpt: "軸と頂点、判別式の扱いを含む3問セット。",
    score: 0.8,
    refType: "generated_content",
    subject: "math",
    refId: "local-2",
  },
  {
    id: "local-3",
    label: "時制の一致Q&A",
    excerpt: "時制の一致を判断する短答式セット。用法の例文と解説付き。",
    score: 0.72,
    refType: "generated_content",
    subject: "english",
    refId: "local-3",
  },
];

const normalizeMatches = (matches: SemanticMatch[] | undefined) =>
  matches?.map((match) => ({
    id: match.id,
    label: match.label,
    excerpt: match.excerpt,
    score: Number(match.score ?? 0),
    refType: match.refType,
    refId: match.refId,
    subject: match.subject,
  })) ?? [];

const applySemanticFilters = (
  matches: SemanticMatch[],
  options?: SemanticSearchOptions,
) =>
  matches.filter((match) => {
    if (options?.refType && match.refType !== options.refType) return false;
    if (options?.subject && match.subject && match.subject !== options.subject) return false;
    return true;
  });

export const semanticSearch = async (
  query: string,
  topK = 5,
  options?: SemanticSearchOptions,
): Promise<SemanticMatch[]> => {
  if (!query.trim()) return [];

  try {
    const data = await requestJson<{ results: SemanticMatch[] }>({
      path: "/search/semantic",
      method: "POST",
      body: { query, topK, refType: options?.refType, subject: options?.subject },
    });
    return applySemanticFilters(normalizeMatches(data.results), options);
  } catch (error) {
    console.warn("semantic search fell back to local mock", error);
    const filtered = applySemanticFilters(
      fallbackMatches.filter((match) =>
        match.label.toLowerCase().includes(query.toLowerCase()),
      ),
      options,
    );
    return filtered.slice(0, topK);
  }
};

export const proxyChat = async (
  prompt: string,
  opts?: { preset?: string; topK?: number; tone?: string },
): Promise<ChatReply> => {
  if (!prompt.trim()) {
    return { reply: "", toolCalls: [], related: [] };
  }

  try {
    const data = await requestJson<{
      message: string;
      toolCalls?: ToolCallLog[];
      related?: SemanticMatch[];
      intent?: ChatReply["intent"];
      actions?: ProxyActions;
    }>({
      path: "/ai/proxy",
      method: "POST",
      body: {
        prompt,
        model: opts?.preset,
        topK: opts?.topK ?? 3,
        tone: opts?.tone,
      },
    });

    return {
      reply: data.message ?? "応答が空でした。",
      toolCalls: data.toolCalls ?? [],
      related: normalizeMatches(data.related),
      intent: data.intent,
      actions: data.actions,
    };
  } catch (error) {
    console.warn("proxy chat fell back to local mock", error);
    return {
      reply:
        "バックエンドに接続できなかったのでローカルで検索した結果を提示します。",
      toolCalls: [
        {
          tool: "semantic_search",
          detail: `mocked query="${prompt.slice(0, 20)}"`,
          result: "ローカル相関候補を返却",
        },
      ],
      related: fallbackMatches.slice(0, opts?.topK ?? 3),
      intent: "search",
    };
  }
};

export const invokeTool = async (
  tool: ToolName,
  params?: Record<string, unknown>,
): Promise<ToolInvocation> =>
  requestJson<ToolInvocation>({
    path: "/ai/tools",
    method: "POST",
    body: { tool, params },
  });
