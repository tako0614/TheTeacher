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
  subject?: string;
};

export type ChatReply = {
  reply: string;
  toolCalls: ToolCallLog[];
  related: SemanticMatch[];
};

const apiBase =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE
    ? import.meta.env.VITE_API_BASE
    : "http://localhost:8787";

const fallbackMatches: SemanticMatch[] = [
  {
    id: "local-1",
    label: "高校数学I: 二次関数",
    excerpt: "平方完成と軸・頂点の求め方をまとめた教材サマリ。",
    score: 0.85,
    refType: "learning",
    subject: "math",
  },
  {
    id: "local-2",
    label: "基本計算セット (練習問題)",
    excerpt: "軸と頂点、判別式の扱いを含む3問セット。",
    score: 0.8,
    refType: "generated_content",
    subject: "math",
  },
  {
    id: "local-3",
    label: "時制の一致Q&A",
    excerpt: "時制の一致を判断する短答式セット。用法の例文と解説付き。",
    score: 0.72,
    refType: "generated_content",
    subject: "english",
  },
];

const postJson = async <T>(path: string, payload: unknown): Promise<T> => {
  const res = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }

  return (await res.json()) as T;
};

const normalizeMatches = (matches: SemanticMatch[] | undefined) =>
  matches?.map((match) => ({
    id: match.id,
    label: match.label,
    excerpt: match.excerpt,
    score: Number(match.score ?? 0),
    refType: match.refType,
    subject: match.subject,
  })) ?? [];

export const semanticSearch = async (
  query: string,
  topK = 5,
): Promise<SemanticMatch[]> => {
  if (!query.trim()) return [];

  try {
    const data = await postJson<{ results: SemanticMatch[] }>(
      "/search/semantic",
      { query, topK },
    );
    return normalizeMatches(data.results);
  } catch (error) {
    console.warn("semantic search fell back to local mock", error);
    return fallbackMatches
      .filter((match) =>
        match.label.toLowerCase().includes(query.toLowerCase()),
      )
      .slice(0, topK);
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
    const data = await postJson<{
      message: string;
      toolCalls?: ToolCallLog[];
      related?: SemanticMatch[];
    }>("/ai/proxy", {
      prompt,
      model: opts?.preset,
      topK: opts?.topK ?? 3,
      tone: opts?.tone,
    });

    return {
      reply: data.message ?? "応答が空でした。",
      toolCalls: data.toolCalls ?? [],
      related: normalizeMatches(data.related),
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
    };
  }
};
