import type { Prisma } from "@prisma/client/edge";
import type { D1Database } from "@cloudflare/workers-types";
import type {
  GenerateFromMaterialRequest,
  GeneratedContent,
  GenerationJob,
  Learning,
  Material,
  PracticeFeedback,
  PracticeGradingRequest,
  RichContentBlock,
  RichContentDocument,
  RichDiagramBlock,
  SimilarQuestion,
  StructuredValue,
} from "@theteacher/shared";
import { practiceFeedbackSchema, richContentDocumentSchema } from "@theteacher/shared";

import { DEFAULT_USER_ID } from "../core/auth";
import { ToolCallError } from "../core/errors";
import { getPrismaClient, nowIso } from "../core/prisma";
import type { AppBindings } from "../core/types";
import {
  fetchLatestMaterialForLearning,
  fetchLearning,
  fetchMaterial,
  fetchPreset,
  mapGeneratedContent,
} from "./data";
import { callOpenAiForGeneration } from "./openai";
import {
  indexGeneratedContentSemanticNode,
  indexMaterialSemanticNode,
} from "./semantic";
import { joinChatContent, summarizeText } from "./utils";

export const saveGeneratedContent = async (
  db: D1Database,
  data: Omit<GeneratedContent, "id" | "createdAt"> &
    Partial<Pick<GeneratedContent, "id" | "createdAt">>,
  userId: string = DEFAULT_USER_ID,
  env?: AppBindings,
): Promise<GeneratedContent> => {
  const id = data.id ?? crypto.randomUUID();
  const createdAt = data.createdAt ?? nowIso();
  const prisma = getPrismaClient(db);

  const row = await prisma.generatedContent.upsert({
    where: { id },
    create: {
      id,
      userId,
      learningId: data.learningId,
      materialId: data.materialId ?? null,
      type: data.type,
      content: data.content as unknown as Prisma.JsonValue,
      promptPreset: data.promptPreset ?? null,
      createdAt,
    },
    update: {
      materialId: data.materialId ?? null,
      type: data.type,
      content: data.content as unknown as Prisma.JsonValue,
      promptPreset: data.promptPreset ?? null,
    },
  });
  const saved = mapGeneratedContent(row);
  const learning = await fetchLearning(db, saved.learningId, userId);
  await indexGeneratedContentSemanticNode(db, env, saved, learning?.subject ?? undefined);
  return saved;
};

const splitIdeas = (text: string, limit = 3) => {
  const normalized = text.replace(/\s+/g, " ").trim();
  const sentences = normalized
    .split(/(?<=[。.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (sentences.length >= limit) return sentences.slice(0, limit);
  const newlineChunks = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const words = normalized
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const joined = newlineChunks.length ? newlineChunks.join(" ") : words.join(" ");
  return (sentences.length ? sentences : [joined]).slice(0, limit);
};

interface PresetContext {
  title?: string;
  systemPrompt?: string;
  userTemplate?: string;
}

export const buildGenerationJob = (
  types: GenerateFromMaterialRequest["types"],
  preset?: PresetContext,
  details?: { modelName?: string; tokens?: number },
): GenerationJob => {
  const noteParts = [
    preset?.title ? `preset="${preset.title}"` : undefined,
    details?.modelName ? `model="${details.modelName}"` : undefined,
    typeof details?.tokens === "number" && Number.isFinite(details.tokens)
      ? `tokens=${Math.round(details.tokens)}`
      : undefined,
  ].filter(Boolean);

  return {
    createdAt: nowIso(),
    completedAt: nowIso(),
    presetTitle: preset?.title,
    types,
    notes: noteParts.length ? noteParts.join(" ") : undefined,
  };
};

const condenseIdea = (text: string, limit = 120) => summarizeText(text, limit).replace(/\s+/g, " ");

const sanitizeLabel = (text: string, limit = 48) =>
  condenseIdea(text, limit)
    .replace(/[\n\r]+/g, " ")
    .trim();

const cleanMaterialText = (value?: string) =>
  typeof value === "string" ? value.replaceAll("\u0000", " ").trim() : "";

const MATERIAL_CONTEXT_CHAR_LIMIT = 10_000;

export const createAdhocMaterialFromText = async (
  db: D1Database,
  learning: Learning,
  text: string,
  env?: AppBindings,
  options?: { title?: string; sourceLabel?: string },
): Promise<Material> => {
  const normalized = cleanMaterialText(text).slice(0, MATERIAL_CONTEXT_CHAR_LIMIT);
  if (!normalized) {
    throw new ToolCallError(
      "material_empty",
      "materialText is empty; provide a prompt or upload content first.",
      400,
    );
  }
  const now = nowIso();
  const id = crypto.randomUUID();
  const title =
    sanitizeLabel(options?.title ?? condenseIdea(normalized, 80), 80) || "AIチャット生成教材";
  const material: Material = {
    id,
    userId: learning.userId,
    learningId: learning.id,
    type: "text",
    sourcePath: title,
    rawContent: normalized,
    metadata: {
      sourceLabel: options?.sourceLabel ?? "ai_chat_prompt",
      preview: summarizeText(normalized, 200),
      createdFrom: "proxy_chat",
      promptTitle: options?.title,
    },
    createdAt: now,
    updatedAt: now,
  };

  const prisma = getPrismaClient(db);
  await prisma.material.upsert({
    where: { id: material.id },
    create: {
      id: material.id,
      userId: learning.userId,
      learningId: material.learningId,
      type: material.type,
      sourcePath: material.sourcePath,
      rawContent: material.rawContent,
      metadata: material.metadata as unknown as Prisma.JsonValue,
      createdAt: material.createdAt,
      updatedAt: material.updatedAt,
    },
    update: {
      sourcePath: material.sourcePath,
      rawContent: material.rawContent,
      metadata: material.metadata as unknown as Prisma.JsonValue,
      updatedAt: material.updatedAt,
    },
  });
  await indexMaterialSemanticNode(db, env, material, learning.subject ?? undefined);
  return material;
};

export const resolveMaterialForGeneration = async (
  db: D1Database,
  env: AppBindings | undefined,
  request: GenerateFromMaterialRequest,
  learning: Learning,
  userId: string = learning.userId,
): Promise<{ material: Material; createdFromText: boolean }> => {
  const fallbackText = cleanMaterialText(request.materialText).slice(0, MATERIAL_CONTEXT_CHAR_LIMIT);
  const existing =
    request.materialId && request.materialId.length > 0
      ? await fetchMaterial(db, request.materialId, userId)
      : await fetchLatestMaterialForLearning(db, request.learningId, userId);

  if (existing?.rawContent?.trim()) {
    return { material: existing, createdFromText: false };
  }

  if (fallbackText) {
    if (existing) {
      const updatedAt = nowIso();
      const source = existing.sourcePath ?? request.materialTitle ?? condenseIdea(fallbackText, 80);
      const prisma = getPrismaClient(db);
      await prisma.material.update({
        where: { id: existing.id },
        data: { rawContent: fallbackText, sourcePath: source, updatedAt },
      });
      const refreshed = await fetchMaterial(db, existing.id, userId);
      if (refreshed) {
        await indexMaterialSemanticNode(db, env, refreshed, learning.subject ?? undefined);
        return { material: refreshed, createdFromText: true };
      }
    }
    const material = await createAdhocMaterialFromText(db, learning, fallbackText, env, {
      title: request.materialTitle,
      sourceLabel: "ai_chat_prompt",
    });
    return { material, createdFromText: true };
  }

  if (existing) {
    throw new ToolCallError(
      "material_empty",
      "This material does not contain extracted text. Provide materialText or upload content first.",
      400,
    );
  }

  throw new ToolCallError(
    "material_not_found",
    "No material available for generation. Provide materialText or upload content first.",
    404,
  );
};

const latexSafe = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/([{}_#%&$])/g, "\\$1")
    .replace(/\s+/g, " ");

const buildConceptDiagram = (ideas: string[], title: string): RichDiagramBlock => {
  const nodes = (ideas.length ? ideas : ["教材の要点"])
    .slice(0, 4)
    .map((idea, index) => ({
      id: `node-${index}`,
      label: sanitizeLabel(idea, 18) || `概念${index + 1}`,
      description: condenseIdea(idea, 60),
    }));
  const edges = nodes
    .slice(1)
    .map((node, index) => ({
      from: nodes[index].id,
      to: node.id,
      label: `関連 ${index + 1}`,
    }));
  return {
    type: "diagram",
    title,
    description: "教材内の概念間のつながりを示す簡易レイアウト",
    layout: nodes.length > 2 ? "horizontal" : "vertical",
    nodes,
    edges,
  };
};

const buildScoreFormula = (label: string, denominator: number) =>
  `\\text{${latexSafe(label)}} = \\frac{\\text{習得項目}}{${Math.max(1, denominator)}} \\times 100`;

const buildTimelineBlock = (ideas: string[]) => ({
  type: "timeline" as const,
  title: "理解のステップ",
  events: (ideas.length ? ideas : ["導入"])
    .slice(0, 5)
    .map((idea, index) => ({
      label: `ステップ${index + 1}`,
      description: condenseIdea(idea, 120),
      date: `T+${index + 1}`,
    })),
});

const buildStructuredDataBlock = (title: string, data: Record<string, unknown>): RichContentBlock => ({
  type: "structured_data",
  title,
  format: "json",
  data: data as StructuredValue,
});

const buildContentForType = (
  type: GeneratedContent["type"],
  ideas: string[],
  baseText: string,
  preset?: PresetContext,
): RichContentDocument => {
  const sourceTitle = (preset?.title ?? "学習対象").replace(/\s+/g, " ");
  const presetHint = preset?.userTemplate
    ? preset.userTemplate.replace(/\{\{.*?\}\}/g, "").slice(0, 120)
    : undefined;

  if (type === "qa") {
    const pairs = ideas.map((idea, index) => ({
      question: `Q${index + 1}: ${summarizeText(idea, 72)} は何を意味しますか？`,
      answer: idea,
      rationale: presetHint ?? `教材から抽出: ${summarizeText(idea, 120)}`,
    }));
    return {
      title: `${sourceTitle} 一問一答`,
      preview: pairs[0]?.question ?? "教材の要点からQ&Aを生成しました。",
      description: "教材の要点を即答できるようQ&Aへ落とし込みました。",
      sections: [
        {
          title: "質問と回答一覧",
          description: "左列で問い、右列で即答・根拠を整理しています。",
          blocks: [
            {
              type: "table",
              caption: "一問一答リスト",
              headers: ["質問", "回答", "根拠"],
              rows: pairs.map((pair) => [pair.question, pair.answer, pair.rationale ?? "教材参照"]),
            },
          ],
        },
        {
          title: "暗記カード",
          blocks: [
            {
              type: "list",
              ordered: false,
              items: pairs.map((pair) => ({
                title: pair.question,
                body: pair.answer,
              })),
            },
          ],
        },
        {
          title: "概念マップ",
          blocks: [buildConceptDiagram(pairs.map((pair) => pair.answer), "テーマの関連図")],
        },
      ],
      blocks: [
        {
          type: "math",
          latex: buildScoreFormula("暗記スコア", pairs.length),
          displayMode: true,
        },
      ],
      metadata: { qaPairs: pairs },
    };
  }

  if (type === "practice") {
    const items = ideas.map((idea, index) => ({
      prompt: `設問${index + 1}: ${summarizeText(idea, 90)}`,
      expectedAnswer: idea,
      hint: presetHint ?? `キーワード: ${summarizeText(idea, 42)}`,
      explanation: summarizeText(`${idea} に基づき、主要手順を文章で説明してください。`, 140),
    }));
    return {
      title: `${sourceTitle} 練習問題`,
      preview: items[0]?.prompt ?? "教材から短答式の問題を生成しました。",
      description: "演習と採点のヒントを同じカード内で参照できます。",
      sections: [
        {
          title: "演習セット",
          description: "ヒント付きの穴埋め・短答を順番に解きます。",
          blocks: [
            {
              type: "list",
              ordered: true,
              items: items.map((item) => ({
                title: item.prompt,
                body: item.hint,
              })),
            },
            {
              type: "table",
              caption: "模範解答",
              headers: ["設問", "模範解答", "解説"],
              rows: items.map((item, index) => [
                `Q${index + 1}`,
                item.expectedAnswer,
                item.explanation,
              ]),
            },
          ],
        },
        {
          title: "理解のステップ",
          blocks: [buildTimelineBlock(items.map((item) => item.expectedAnswer))],
        },
      ],
      blocks: [
        {
          type: "math",
          latex: buildScoreFormula("採点基準", items.length),
          displayMode: true,
        },
        buildStructuredDataBlock("問題メタデータ", {
          問題数: items.length,
          参考教材: sourceTitle,
          使用プリセット: preset?.title ?? "デフォルト",
        }),
      ],
      metadata: { practiceItems: items },
    };
  }

  if (type === "podcast_script") {
    const segments = ideas.map((idea, index) => ({
      speaker: index % 2 === 0 ? "Host" : "Guest",
      text: summarizeText(`${preset?.systemPrompt ? `${preset.systemPrompt} / ` : ""}${idea}`, 140),
    }));
    return {
      title: `${sourceTitle} ポッドキャスト用スクリプト`,
      preview: segments[0]?.text ?? "対話形式のスクリプトを生成しました。",
      description: "台本テキストに加えて話者の流れをタイムライン化しました。",
      sections: [
        {
          title: "スクリプト",
          blocks: [
            {
              type: "list",
              ordered: false,
              items: segments.map((segment) => ({
                title: `${segment.speaker}`,
                body: segment.text,
              })),
            },
          ],
        },
        {
          title: "進行図",
          blocks: [buildConceptDiagram(segments.map((segment) => segment.text), "会話の流れ")],
        },
      ],
      blocks: [
        buildStructuredDataBlock("収録メモ", {
          セグメント数: segments.length,
          主要話者: segments
            .map((segment) => segment.speaker)
            .filter((value, index, arr) => arr.indexOf(value) === index),
        }),
      ],
      metadata: { podcastSegments: segments },
    };
  }

  if (type === "other") {
    const highlights = (ideas.length ? ideas : [summarizeText(baseText, 180)]).slice(0, 5);
    return {
      title: `${sourceTitle} リッチノート`,
      preview: summarizeText(highlights[0] ?? baseText, 60),
      description: presetHint ?? "図形・数式・表を含むリッチノートの雛形です。",
      sections: [
        {
          title: "キーポイント",
          description: "主要概念の抜粋とメモ",
          blocks: [
            {
              type: "list",
              ordered: false,
              items: highlights.map((idea, index) => ({
                title: `ポイント${index + 1}`,
                body: condenseIdea(idea, 160),
                math: index === 0 ? buildScoreFormula("理解度", highlights.length) : undefined,
              })),
            },
            {
              type: "table",
              caption: "要点サマリ",
              headers: ["#", "概要"],
              rows: highlights.map((idea, index) => [`${index + 1}`, summarizeText(idea, 80)]),
            },
          ],
        },
        {
          title: "構造化ビュー",
          description: "概念間のつながりと学びの順序を図示",
          blocks: [
            buildConceptDiagram(highlights, "関連図"),
            buildTimelineBlock(highlights),
          ],
        },
        {
          title: "メタデータ",
          description: "設定や抽出情報を構造化して記録",
          blocks: [
            buildStructuredDataBlock("生成メモ", {
              ハイライト数: highlights.length,
              使用プリセット: preset?.title ?? "デフォルト",
              抜粋元: sourceTitle,
            }),
          ],
        },
      ],
      blocks: [
        {
          type: "math",
          latex: buildScoreFormula("復習優先度", highlights.length),
          displayMode: true,
        },
      ],
      metadata: { highlights },
    };
  }

  if (type === "summary") {
    const bullets = ideas.map((idea) => summarizeText(idea, 120));
    return {
      title: `${sourceTitle} 要約`,
      preview: bullets.join(" / ").slice(0, 140),
      description: summarizeText(baseText, 200),
      sections: [
        {
          title: "ポイント",
          blocks: [
            {
              type: "list",
              ordered: false,
              items: bullets.map((bullet) => ({
                title: bullet,
              })),
            },
          ],
        },
        {
          title: "理解の流れ",
          blocks: [buildTimelineBlock(ideas)],
        },
      ],
      blocks: [
        buildStructuredDataBlock("要約メタ", {
          主要トピック数: bullets.length,
          抽出元: sourceTitle,
        }),
      ],
      metadata: { summaryBullets: bullets },
    };
  }

  return {
    title: `${sourceTitle} 生成コンテンツ`,
    preview: summarizeText(baseText, 80),
    description: "単純なテキストプレビューです。",
    sections: [
      {
        title: "プレビュー",
        blocks: [
          {
            type: "text",
            variant: "paragraph",
            text: summarizeText(baseText, 320),
          },
        ],
      },
    ],
    blocks: [],
  };
};

interface GenerationGuide {
  label: string;
  objective: string;
  instructions: string;
  schema: string;
  temperature?: number;
  maxTokens?: number;
}

const generationTypeGuides: Record<GeneratedContent["type"], GenerationGuide> = {
  qa: {
    label: "一問一答",
    objective: "教材の核心トピックから5問の短い質問と回答を抽出する",
    instructions: [
      "- pairs は教材の重要概念を問う 5 件以上の一問一答で構成する",
      "- question は高校生にも分かる日本語の問いかけ文にする",
      "- answer は2文以内で根拠を明示し、教材内の語句を引用する",
      "- rationale には答えの導出過程や参照箇所（節・キーワード）を簡潔に書く",
    ].join("\n"),
    schema: `{
  "title": "string",
  "preview": "string (最初の質問の要約。全角40文字以内)",
  "pairs": [
    {
      "question": "string",
      "answer": "string",
      "rationale": "string"
    }
  ]
}`,
    temperature: 0.35,
    maxTokens: 900,
  },
  practice: {
    label: "練習問題",
    objective: "短答・記述混在の演習問題を3〜5問作成する",
    instructions: [
      "- items には 3〜5 問の演習問題を含める",
      "- prompt は問題文、expectedAnswer は模範解答、hint は思考のヒントを1文で書く",
      "- explanation には採点時に伝えるべき要点や誤りがちな点を書く",
      "- 記述式の問いを最低1問含め、得点差が付く要素を説明する",
    ].join("\n"),
    schema: `{
  "title": "string",
  "preview": "string (代表問題の要約)",
  "items": [
    {
      "prompt": "string",
      "expectedAnswer": "string",
      "hint": "string",
      "explanation": "string"
    }
  ]
}`,
    temperature: 0.35,
    maxTokens: 1100,
  },
  summary: {
    label: "要約",
    objective: "教材の要点を3〜5個の箇条書きと短い概要文に整理する",
    instructions: [
      "- bullets には教材のキーメッセージを 3〜5 件含める",
      "- summary は 3〜4 文で全体像→重要概念→次に学ぶべき内容の順に書く",
      "- 可能なら数式や年号など具体的な値を一つ以上含める",
    ].join("\n"),
    schema: `{
  "title": "string",
  "preview": "string (bullet の先頭要約)",
  "bullets": ["string"],
  "summary": "string"
}`,
    temperature: 0.25,
    maxTokens: 700,
  },
  podcast_script: {
    label: "ポッドキャスト用スクリプト",
    objective: "講師と生徒（もしくは2名の出演者）が交互に解説する台本を用意する",
    instructions: [
      "- segments は 6〜8 個の会話セクションで構成し、speaker には登場人物名を入れる",
      "- text は1セグメントあたり2〜3文程度で、例え話や質問を交える",
      "- 概念導入→掘り下げ→まとめ の流れになるよう配置する",
    ].join("\n"),
    schema: `{
  "title": "string",
  "preview": "string (冒頭セグメントの抜粋)",
  "segments": [
    {
      "speaker": "string",
      "text": "string"
    }
  ]
}`,
    temperature: 0.55,
    maxTokens: 1200,
  },
  other: {
    label: "リッチノート",
    objective: "図解・数式・表を交えた構造化ノートをまとめる",
    instructions: [
      "- sections を 2〜4 件用意し、text/math/table/list/timeline/diagram/structured_data を組み合わせてブロックを作る",
      "- math は LaTeX で正規化し、diagram は 3〜6 ノード・簡素なラベルで構造を示す",
      "- table は 3〜6 行・3 列以内で主要な比較や手順を示す。timeline には時系列のラベルと説明を入れる",
      "- structured_data には主要パラメータ・値を JSON でまとめ、前段のブロックの要約として使う",
      "- 事実が足りない場合は不足を明示し、確かな情報のみ書く。出力内の文章はすべて日本語にする",
    ].join("\n"),
    schema: `{
  "title": "string",
  "preview": "string (先頭セクションの要約。全角40文字以内)",
  "description": "string (全体の狙いを1〜2文)",
  "sections": [{
    "title": "string",
    "description": "string",
    "blocks": [
      { "type": "text", "text": "string", "variant": "heading|paragraph|quote|code", "badge": "string" },
      { "type": "math", "latex": "string", "displayMode": true },
      { "type": "table", "caption": "string", "headers": ["string"], "rows": [["string|number|boolean|null"]] },
      { "type": "list", "title": "string", "ordered": false, "items": ["string" | { "title": "string", "body": "string", "math": "string" }] },
      { "type": "timeline", "title": "string", "events": [{ "label": "string", "description": "string", "date": "string" }] },
      { "type": "diagram", "title": "string", "description": "string", "layout": "horizontal|vertical", "nodes": [{ "id": "string", "label": "string", "description": "string" }], "edges": [{ "from": "string", "to": "string", "label": "string" }] },
      { "type": "structured_data", "title": "string", "format": "key_value|json|metrics", "data": { "key": "value" } }
    ]
  }],
  "blocks": []
}`,
    temperature: 0.3,
    maxTokens: 1400,
  },
};

const baseGenerationSystemPrompt =
  "You are TheTeacher, an assistant that writes Japanese learning assets from source material. Always follow the requested JSON schema, keep answers factual, and stay concise.";

const stripJsonFence = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith("```")) {
    const withoutFence = trimmed.replace(/^```[a-z]*\s*/i, "").replace(/```$/, "");
    return withoutFence.trim();
  }
  return trimmed;
};

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

const ensureStringArray = (value: unknown, fallback: string[], limit: number) => {
  if (!Array.isArray(value)) return fallback;
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (trimmed.length > 0) {
        items.push(trimmed);
        if (items.length >= limit) break;
      }
    }
  }
  return items.length ? items : fallback;
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

const mapRecordArray = <T>(
  value: unknown,
  limit: number,
  transform: (record: Record<string, unknown>, index: number) => T | null,
): T[] => {
  if (!Array.isArray(value)) return [];
  const items: T[] = [];
  value.some((entry, index) => {
    const record = asRecord(entry);
    if (!record) return false;
    const mapped = transform(record, index);
    if (mapped) {
      items.push(mapped);
      if (items.length >= limit) {
        return true;
      }
    }
    return false;
  });
  return items;
};

const parseAssistantJson = (raw: string) => {
  const normalized = stripJsonFence(raw);
  const tryParse = (text: string) => {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("response was not a JSON object");
    }
    return parsed as Record<string, unknown>;
  };

  try {
    return tryParse(normalized);
  } catch {
    const start = normalized.indexOf("{");
    const end = normalized.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return tryParse(normalized.slice(start, end + 1));
    }
    throw new ToolCallError("generation_parse_failed", "Failed to parse AI response as JSON");
  }
};

const applyMaterialTemplate = (
  template: string | undefined,
  context: string,
  guide: GenerationGuide,
) => {
  if (!template) return undefined;
  const placeholders = {
    "{{objective}}": guide.objective,
    "{{instructions}}": guide.instructions,
    "{{context}}": context,
  };
  return Object.entries(placeholders).reduce(
    (prompt, [key, value]) => prompt.replace(new RegExp(key, "g"), value),
    template,
  );
};

const buildMaterialContext = (
  learning: Learning,
  material: Material,
  materialText: string,
  ideas: string[],
) => {
  const truncatedText = materialText.slice(0, 9_000);
  const truncatedNotice = materialText.length > truncatedText.length ? "\n\n[Truncated]" : "";
  const nameCandidates = ideas.slice(0, 3).map((idea) => sanitizeLabel(idea, 80));
  const keyPoints = ideas.slice(0, 8).map((idea, index) => `- Point ${index + 1}: ${idea}`);

  const lines = [
    `Learning Title: ${learning.title}`,
    learning.subject ? `Subject: ${learning.subject}` : null,
    learning.tags?.length ? `Tags: ${learning.tags.join(", ")}` : null,
    `Material Type: ${material.type}`,
    nameCandidates[0] ? `Material Name: ${nameCandidates[0]}` : null,
    material.sourcePath ? `Source Path: ${material.sourcePath}` : null,
    `Extracted Characters: ${materialText.length}`,
  ].filter(Boolean);

  return (
    `${lines.join("\n")}\n\n# Key Points\n${
      keyPoints.length ? keyPoints.join("\n") : "- キーポイントを抽出できませんでした"
    }\n\n# Material Text\n"""${truncatedText || "教材本文が空です"}"""${truncatedNotice}`
  );
};

const buildUserPromptForType = (
  templatePrompt: string | undefined,
  context: string,
  guide: GenerationGuide,
) => {
  const baseInstruction =
    templatePrompt ?? `次の教材から ${guide.objective}。\n\n${context}`;
  return [
    baseInstruction.trim(),
    "",
    "# Output Requirements",
    guide.instructions,
    "",
    "# JSON Schema",
    guide.schema,
    "",
    "制約:",
    "- 出力は上記スキーマ通りの単一JSONオブジェクト",
    "- 文章はすべて日本語で書く",
    "- 教材に含まれない情報を推測で補わない",
  ].join("\n");
};

const pickRichContentDocument = (...candidates: unknown[]): RichContentDocument | null => {
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const parsed = richContentDocumentSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
    const record = candidate as Record<string, unknown>;
    const nested =
      record.document ?? record.richDocument ?? record.rich_content ?? record.richContent;
    if (nested) {
      const nestedParsed = richContentDocumentSchema.safeParse(nested);
      if (nestedParsed.success) return nestedParsed.data;
    }
  }
  return null;
};

const normalizeGeneratedPayload = (
  type: GeneratedContent["type"],
  parsed: Record<string, unknown>,
  fallback: Record<string, unknown>,
) => {
  const fallbackTitle = ensureString(fallback.title);
  const fallbackPreview = ensureString(fallback.preview);

  if (type === "other") {
    const parsedRichDocument = pickRichContentDocument(
      parsed,
      (parsed as { document?: unknown }).document,
    );
    const fallbackRichDocument = pickRichContentDocument(fallback);
    if (parsedRichDocument) {
      return {
        ...parsedRichDocument,
        title: ensureString(parsedRichDocument.title, fallbackTitle || "リッチノート"),
        preview: ensureString(
          parsedRichDocument.preview,
          fallbackPreview || parsedRichDocument.description || parsedRichDocument.title || "",
        ),
      };
    }

    const sectionsCandidate =
      pickField(parsed, ["sections", "blocks", "items"]) ?? pickField(parsed, ["data"]);
    const sections = mapRecordArray(sectionsCandidate, 6, (record) => {
      const title = ensureString(pickField(record, ["title", "heading", "label"]));
      const description = ensureString(
        pickField(record, ["description", "body", "text", "summary"]),
      );
      const math = ensureString(pickField(record, ["latex", "math", "formula"]));
      const blocks: RichContentBlock[] = [];
      if (title) {
        blocks.push({ type: "text", text: title, variant: "heading" });
      }
      if (description) {
        blocks.push({ type: "text", text: description, variant: "paragraph" });
      }
      if (math) {
        blocks.push({ type: "math", latex: math, displayMode: true });
      }
      if (!blocks.length) return null;
      return {
        title: title || undefined,
        description: description || undefined,
        blocks,
      };
    });
    const body = ensureString(
      pickField(parsed, ["body", "text", "summary", "notes", "description"]),
      fallbackPreview,
    );
    return {
      title: ensureString(parsed.title, fallbackTitle || "リッチノート"),
      preview: ensureString(parsed.preview, fallbackPreview || body || sections[0]?.description || ""),
      description: body || undefined,
      sections: sections.length ? sections : fallbackRichDocument?.sections ?? [],
      blocks: sections.length || !body
        ? fallbackRichDocument?.blocks ?? []
        : [{ type: "text", text: body, variant: "paragraph" }],
      metadata: fallbackRichDocument?.metadata,
    };
  }

  if (type === "qa") {
    const fallbackPairs = Array.isArray((fallback as { pairs?: unknown }).pairs)
      ? ((fallback as { pairs?: { question: string; answer: string; rationale?: string }[] }).pairs ??
        [])
      : [];
    const pairsCandidate =
      pickField(parsed, ["pairs", "questions", "items", "qa"]) ??
      pickField(parsed, ["data"]);
    const pairs = mapRecordArray(pairsCandidate, 12, (record) => {
      const question = ensureString(pickField(record, ["question", "prompt", "q"]));
      const answer = ensureString(pickField(record, ["answer", "response", "a", "solution"]));
      if (!question || !answer) return null;
      const rationale = ensureString(
        pickField(record, ["rationale", "reason", "explanation", "note"]),
      );
      return rationale ? { question, answer, rationale } : { question, answer };
    });
    return {
      title: ensureString(parsed.title, fallbackTitle || "一問一答"),
      preview: ensureString(
        parsed.preview,
        fallbackPreview || pairs[0]?.question || fallbackPairs[0]?.question || "",
      ),
      pairs: pairs.length ? pairs : fallbackPairs,
    };
  }

  if (type === "practice") {
    const fallbackItems = Array.isArray((fallback as { items?: unknown }).items)
      ? ((fallback as { items?: { prompt: string; expectedAnswer: string; hint?: string; explanation?: string }[] }).items ??
        [])
      : [];
    const itemsCandidate = pickField(parsed, ["items", "questions", "practice"]);
    const items = mapRecordArray(itemsCandidate, 10, (record) => {
      const prompt = ensureString(pickField(record, ["prompt", "question", "q"]));
      const expectedAnswer = ensureString(
        pickField(record, ["expectedAnswer", "expected", "answer", "a", "solution"]),
      );
      if (!prompt || !expectedAnswer) return null;
      const hint = ensureString(pickField(record, ["hint", "tip", "note", "rationale"]));
      const explanation = ensureString(
        pickField(record, ["explanation", "reasoning", "why", "analysis"]),
      );
      return { prompt, expectedAnswer, hint, explanation };
    });
    const representative = items[0] ?? fallbackItems[0];
    const fallbackPreview = ensureString((fallback as { preview?: unknown }).preview);
    return {
      title: ensureString((parsed as { title?: unknown }).title, fallbackTitle || "練習問題"),
      preview: ensureString(
        parsed.preview,
        fallbackPreview || representative?.prompt || "",
      ),
      items: items.length ? items : fallbackItems,
    };
  }

  if (type === "summary") {
    const fallbackBullets = Array.isArray((fallback as { bullets?: unknown }).bullets)
      ? ((fallback as { bullets?: string[] }).bullets ?? [])
      : [];
    const fallbackSummary = ensureString((fallback as { summary?: unknown }).summary);
    const bulletCandidate =
      pickField(parsed, ["bullets", "highlights", "keyPoints"]) ??
      pickField(parsed, ["items"]);
    const bullets = ensureStringArray(bulletCandidate, fallbackBullets, 6);
    const summaryText = ensureString(
      pickField(parsed, ["summary", "body", "text"]),
      fallbackSummary || bullets.join(" / "),
    );
    return {
      title: ensureString(parsed.title, fallbackTitle || "要約"),
      preview: ensureString(parsed.preview, fallbackPreview || bullets[0] || summaryText),
      bullets,
      summary: summaryText,
    };
  }

  if (type === "podcast_script") {
    const fallbackSegments = Array.isArray((fallback as { segments?: unknown }).segments)
      ? ((fallback as { segments?: { speaker: string; text: string }[] }).segments ?? [])
      : [];
    const segmentsCandidate =
      pickField(parsed, ["segments", "script", "lines", "dialogue", "scriptSections"]) ??
      pickField(parsed, ["items"]);
    const segments = mapRecordArray(segmentsCandidate, 12, (record, index) => {
      const speaker = ensureString(
        pickField(record, ["speaker", "role", "character", "persona"]),
        index % 2 === 0 ? "講師" : "生徒",
      );
      const text = ensureString(pickField(record, ["text", "line", "utterance", "dialogue"]));
      if (!text) return null;
      return { speaker, text };
    });
    return {
      title: ensureString(parsed.title, fallbackTitle || "ポッドキャストスクリプト"),
      preview: ensureString(parsed.preview, fallbackPreview || segments[0]?.text || ""),
      segments: segments.length ? segments : fallbackSegments,
    };
  }

  const fallbackSections = Array.isArray((fallback as { sections?: unknown }).sections)
    ? ((fallback as { sections?: { title?: string; body?: string }[] }).sections ?? [])
    : [];
  const sectionsCandidate =
    pickField(parsed, ["sections", "chapters", "blocks"]) ?? pickField(parsed, ["items"]);
  const sections = mapRecordArray(sectionsCandidate, 10, (record) => {
    const title = ensureString(pickField(record, ["title", "heading", "label"]));
    const body = ensureString(pickField(record, ["body", "text", "description", "summary"]));
    if (!title && !body) return null;
    return title ? { title, body } : { body };
  });
  const body = ensureString(
    pickField(parsed, ["body", "text", "summary", "notes"]),
    ensureString((fallback as { body?: unknown }).body, fallbackPreview),
  );
  return {
    title: ensureString(parsed.title, fallbackTitle || "生成コンテンツ"),
    preview: ensureString(parsed.preview, fallbackPreview || body.slice(0, 60)),
    body,
    sections: sections.length ? sections : fallbackSections,
  };
};

export const generateContentsFromMaterial = async (
  env: AppBindings | undefined,
  request: GenerateFromMaterialRequest,
  learning: Learning,
  material: Material,
  preset?: PresetContext,
) => {
  const materialText = material.rawContent?.trim();
  if (!materialText) {
    throw new ToolCallError(
      "material_empty",
      "This material does not contain extracted text. Please ingest or upload content first.",
      400,
    );
  }
  const sanitized = materialText.replaceAll("\u0000", "");
  const ideas = splitIdeas(sanitized, 8);
  const context = buildMaterialContext(learning, material, sanitized, ideas);
  const promptPreset =
    preset?.title ??
    request.presetTitle ??
    request.presetUserTemplate ??
    request.presetId;

  const drafts: Omit<GeneratedContent, "id" | "createdAt">[] = [];
  let totalTokens = 0;
  let modelName: string | undefined;
  const systemMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: baseGenerationSystemPrompt },
  ];
  if (preset?.systemPrompt) {
    systemMessages.push({ role: "system", content: preset.systemPrompt });
  }

  for (const type of request.types) {
    const guide = generationTypeGuides[type] ?? generationTypeGuides.other;
    const templatePrompt = applyMaterialTemplate(preset?.userTemplate, context, guide);
    const userPrompt = buildUserPromptForType(templatePrompt, context, guide);
    const fallbackContent = buildContentForType(type, ideas, sanitized, preset) as Record<
      string,
      unknown
    >;
    const { text, model, usage } = await callOpenAiForGeneration(
      env,
      [...systemMessages, { role: "user", content: userPrompt }],
      { temperature: guide.temperature, maxTokens: guide.maxTokens },
    );
    const parsed = parseAssistantJson(text);
    const normalized = normalizeGeneratedPayload(type, parsed, fallbackContent);
    drafts.push({
      learningId: request.learningId,
      materialId: material.id,
      type,
      promptPreset: promptPreset ?? undefined,
      content: normalized,
    });
    modelName = model ?? modelName;
    if (usage?.totalTokens) {
      totalTokens += usage.totalTokens;
    }
  }

  return {
    drafts,
    meta: {
      modelName,
      tokens: totalTokens,
    },
  };
};

export const resolvePresetContext = async (
  db: D1Database,
  request: GenerateFromMaterialRequest,
  userId: string = DEFAULT_USER_ID,
): Promise<PresetContext | undefined> => {
  if (request.presetId) {
    const preset = await fetchPreset(db, request.presetId, userId);
    if (preset) {
      return {
        title: preset.title,
        systemPrompt: preset.systemPrompt,
        userTemplate: preset.userInstructionTemplate,
      };
    }
  }

  if (request.presetTitle || request.presetSystemPrompt || request.presetUserTemplate) {
    return {
      title: request.presetTitle,
      systemPrompt: request.presetSystemPrompt,
      userTemplate: request.presetUserTemplate,
    };
  }

  return undefined;
};

const computeTokenOverlapScore = (expected: string, input: string) => {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean);
  const expectedTokens = normalize(expected);
  const answerTokens = normalize(input);
  if (expectedTokens.length === 0 || answerTokens.length === 0) return 0;
  const overlap = answerTokens.filter((token) => expectedTokens.includes(token)).length;
  return Math.min(1, overlap / expectedTokens.length);
};

const buildSimilarQuestions = (question: PracticeGradingRequest["question"]): SimilarQuestion[] => {
  const prompt = summarizeText(question.prompt, 120);
  const hint = question.hint?.trim();
  return [
    {
      prompt: `言い換えパターン: ${prompt}`,
      hint: hint ?? "キーワードを落とさずに短く整理してみましょう。",
    },
    {
      prompt: `応用: ${prompt} を具体例で説明してください。`,
      hint: hint ?? "答えに具体例と理由を1つ添えてください。",
    },
  ];
};

export const buildFallbackFeedback = (
  request: PracticeGradingRequest,
  details?: { reason?: string },
): PracticeFeedback => {
  const expected = request.question.expected ?? "";
  const score = expected ? computeTokenOverlapScore(expected, request.answer) : 0.4;
  const verdict = score >= 0.75 ? "correct" : score >= 0.45 ? "partial" : "incorrect";
  const comment =
    verdict === "correct"
      ? "主要なキーワードが一致しています。次は手順や理由をもう少し具体的に書いてみましょう。"
      : verdict === "partial"
        ? "一部のキーワードは合っていますが、答えが不足しているようです。ヒントや教材を見直してください。"
        : "答えが離れているようです。ヒントに沿って重要語句を入れ直してみてください。";

  return {
    score,
    verdict,
    comment,
    reasoning: expected
      ? `想定解: ${summarizeText(expected, 140)}`
      : "想定解がないため類似度ベースで採点しました。",
    keyPoints: expected ? [summarizeText(expected, 160)] : undefined,
    suggestedSimilar: buildSimilarQuestions(request.question),
    nextAction:
      verdict === "correct"
        ? "関連する類題で理解を確認しましょう。"
        : "回答を一旦短くまとめ、キーワードが含まれているかを確認してから再提出してください。",
    usedAi: false,
    raw: details?.reason,
  };
};

export const gradeWithOpenAi = async (
  env: AppBindings | undefined,
  request: PracticeGradingRequest,
): Promise<PracticeFeedback | null> => {
  const apiKey = env?.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const model = env?.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const attachmentNote =
    request.artifacts && request.artifacts.length > 0
      ? `添付: 画像 ${request.artifacts.length} 件（内容は文字起こし済みとして扱ってください）`
      : "添付なし";
  const messages = [
    {
      role: "system",
      content:
        "You are a supportive Japanese tutor. Grade the student's answer strictly but give concise feedback. Respond ONLY with JSON.",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "採点対象:",
            `- 問題: ${request.question.prompt}`,
            request.question.expected ? `- 模範解答: ${request.question.expected}` : null,
            request.question.hint ? `- ヒント: ${request.question.hint}` : null,
            `- 受験者の回答: ${request.answer}`,
            `- モード: ${request.mode}`,
            `- ${attachmentNote}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
        ...(request.artifacts ?? []).map((artifact) => ({
          type: "image_url" as const,
          image_url: { url: artifact.dataUrl, detail: "low" as const },
        })),
      ],
    },
  ];

  try {
    const response = await fetch(`${env?.OPENAI_API_BASE_URL?.trim() || "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`openai grade failed (${response.status}): ${detail}`);
    }
    const json = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = joinChatContent(json.choices?.[0]?.message?.content);
    if (!content) return null;
    const parsed = practiceFeedbackSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      throw new Error("openai grade response schema mismatch");
    }
    return {
      ...parsed.data,
      usedAi: true,
      raw: content,
    };
  } catch (error) {
    console.warn("gradeWithOpenAi failed", error);
    return null;
  }
};
