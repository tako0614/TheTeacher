import { z } from "zod";
import { schemas, type GenerateFromMaterialRequest, type GeneratedContent, type Learning } from "@theteacher/shared";

import { DEFAULT_USER_ID } from "../core/auth";
import { ToolCallError } from "../core/errors";
import { generateFromMaterialRequestSchema, learningListQuerySchema } from "../core/schemas";
import type { AppBindings } from "../core/types";
import {
  buildGenerationJob,
  createAdhocMaterialFromText,
  generateContentsFromMaterial,
  resolveMaterialForGeneration,
  resolvePresetContext,
  saveGeneratedContent,
} from "./generation";
import type { SerializedMatch } from "./semantic";
import { describeRelatedBrief, fallbackLearnings, subjectLabelMap } from "./semantic";
import { listLearnings, insertLearning, fetchLearning } from "./data";
import { resolveOpenAiBaseUrl } from "./openai";
import { joinChatContent, summarizeText } from "./utils";

type ToolName = "search_learnings" | "create_learning_from_chat" | "generate_questions" | "save_content";

const flattenContent = (content: unknown): string => {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(flattenContent).join(" ");
  if (typeof content === "object") {
    return Object.values(content as Record<string, unknown>)
      .map((value) => flattenContent(value))
      .filter(Boolean)
      .join(" ");
  }
  return String(content);
};

const describeGenerationSummary = (
  generated: GeneratedContent[],
  planned: GenerateFromMaterialRequest["types"],
) => {
  if (generated.length === 0 && planned.length === 0) {
    return "まだ教材/問題を生成していません。";
  }
  const counts = generated.reduce<Record<GeneratedContent["type"], number>>((acc, item) => {
    acc[item.type] = (acc[item.type] ?? 0) + 1;
    return acc;
  }, { qa: 0, practice: 0, summary: 0, podcast_script: 0, other: 0 });
  const plannedText = planned.length ? `予定: ${planned.join(", ")}` : "予定: なし";
  const generatedText = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${type} x${count}`)
    .join(", ");
  return `生成済み: ${generatedText || "なし"} / ${plannedText}`;
};

const describeToolSummary = (toolCalls: ProxyResponseContext["toolCalls"]) => {
  if (!toolCalls.length) return "ツールは未実行です。";
  return toolCalls
    .map((call, index) => `${index + 1}. ${call.tool}: ${call.detail}${call.result ? ` -> ${call.result}` : ""}`)
    .join("\n");
};

export interface ProxyResponseContext {
  prompt: string;
  subject?: string;
  tone?: string;
  related: SerializedMatch[];
  toolCalls: { tool: string; detail: string; result?: string }[];
  createdLearning?: Learning | null;
  shouldCreate: boolean;
  generatedItems: GeneratedContent[];
  plannedTypes: GenerateFromMaterialRequest["types"];
}

interface GeneratedContentSummary {
  id: string;
  type: GeneratedContent["type"];
  title: string;
  learningId?: string;
  learningTitle?: string;
}

interface ProxyActionsPayload {
  createdLearningId?: string;
  createdLearningTitle?: string;
  createdLearningSubject?: string;
  createdLearningReason?: string;
  generatedContentSummaries?: GeneratedContentSummary[];
}

export const buildProxyActionsPayload = (
  prompt: string,
  createdLearning: Learning | null,
  generatedItems: GeneratedContent[],
  targetLearning?: SerializedMatch,
): ProxyActionsPayload => {
  const summaries =
    generatedItems.length > 0
      ? generatedItems.map((item) => ({
          id: item.id,
          type: item.type,
          title: summarizeText(flattenContent(item.content), 80),
          learningId: item.learningId,
          learningTitle: targetLearning?.label,
        }))
      : undefined;
  return {
    createdLearningId: createdLearning?.id,
    createdLearningTitle: createdLearning?.title,
    createdLearningSubject: createdLearning?.subject ?? undefined,
    createdLearningReason: createdLearning ? summarizeText(prompt, 160) : undefined,
    generatedContentSummaries: summaries,
  };
};

export const buildProxyFallbackMessage = (ctx: ProxyResponseContext) => {
  const sections: string[] = [];
  if (ctx.subject) {
    sections.push(`テーマ: ${subjectLabelMap[ctx.subject] ?? ctx.subject}`);
  }
  sections.push(
    ctx.related.length > 0
      ? `関連候補:\n${describeRelatedBrief(ctx.related)}`
      : "既存の教材は見つかりませんでした。",
  );
  if (ctx.createdLearning) {
    sections.push(`チャット内容をもとに「${ctx.createdLearning.title}」という学習カードを用意しました。`);
  } else if (ctx.shouldCreate) {
    sections.push("ヒットが少ないため、新しい学習カードを提案しています。タイトルや科目の希望を教えてください。");
  }
  sections.push(`生成状況: ${describeGenerationSummary(ctx.generatedItems, ctx.plannedTypes)}`);
  sections.push("続けて、欲しい教材や問題の条件を教えてください。");
  return sections.join("\n\n");
};

export const callOpenAiProxyChat = async (env: AppBindings | undefined, ctx: ProxyResponseContext) => {
  const apiKey = env?.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const model = env?.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const payload = {
    model,
    temperature: 0.4,
    messages: [
      {
        role: "system",
        content: `You are an educational AI assistant who plans study units and tool calls for teachers. Reply in Japanese, stay concise, and summarize what you already executed. ${ctx.tone ? `Adopt a ${ctx.tone} tone.` : ""}`,
      },
      {
        role: "user",
        content: [
          `ユーザー入力: ${summarizeText(ctx.prompt, 220)}`,
          `推定教科: ${ctx.subject ? subjectLabelMap[ctx.subject] ?? ctx.subject : "特定不可"}`,
          `関連候補:\n${describeRelatedBrief(ctx.related)}`,
          `ツール実行:\n${describeToolSummary(ctx.toolCalls)}`,
          `生成状況: ${describeGenerationSummary(ctx.generatedItems, ctx.plannedTypes)}`,
          ctx.createdLearning
            ? `新規学習カード「${ctx.createdLearning.title}」を作成済み。`
            : ctx.shouldCreate
              ? "学習カード作成を検討中。"
              : "既存の教材をもとに提案可。",
          "上記を踏まえて、次のアクション案と提案を返してください。",
        ].join("\n\n"),
      },
    ],
  };
  try {
    const response = await fetch(`${resolveOpenAiBaseUrl(env)}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(`openai proxy chat failed (${response.status}): ${detail}`);
    }
    const json = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    const content = joinChatContent(json.choices?.[0]?.message?.content);
    return content || null;
  } catch (error) {
    console.warn("proxy chat openai request failed", error);
    return null;
  }
};

export const executeToolCall = async (
  env: AppBindings | undefined,
  tool: ToolName,
  params: Record<string, unknown>,
  userId: string = DEFAULT_USER_ID,
) => {
  const db = env?.DB;

  if (tool === "search_learnings") {
    if (!db) {
      return { items: fallbackLearnings };
    }
    const query = learningListQuerySchema.parse({
      q: typeof params.q === "string" ? params.q : undefined,
      subject: typeof params.subject === "string" ? params.subject : undefined,
      tag: typeof params.tag === "string" ? params.tag : undefined,
      limit: params.limit ? Number(params.limit) : 10,
    });
    const items = await listLearnings(db, query, userId);
    return { items };
  }

  if (tool === "create_learning_from_chat") {
    if (!db) throw new ToolCallError("db_unavailable", "Database is not available", 503);
    const title =
      typeof params.title === "string" && params.title.trim().length > 0
        ? params.title.trim()
        : undefined;
    if (!title) {
      throw new ToolCallError("invalid_params", "title is required");
    }
    const subject =
      typeof params.subject === "string" && params.subject.trim().length > 0
        ? params.subject.trim()
        : undefined;
    const tags = (Array.isArray(params.tags) ? params.tags : [])
      .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
      .filter(Boolean);
    const materialText =
      typeof params.materialText === "string" && params.materialText.trim().length > 0
        ? params.materialText
        : undefined;
    const materialTitle =
      typeof params.materialTitle === "string" && params.materialTitle.trim().length > 0
        ? params.materialTitle.trim()
        : undefined;
    const learning = await insertLearning(db, { title, subject, tags }, userId, env);
    if (materialText) {
      const material = await createAdhocMaterialFromText(db, learning, materialText, env, {
        title: materialTitle ?? title,
        sourceLabel: "ai_chat_seed",
      });
      return { learning, material };
    }
    return { learning };
  }

  if (tool === "generate_questions") {
    if (!db) throw new ToolCallError("db_unavailable", "Database is not available", 503);
    const normalizedTypes =
      Array.isArray(params.types) && params.types.length > 0
        ? params.types
            .map((value) => (typeof value === "string" ? value : ""))
            .filter(Boolean)
        : undefined;
    const request = generateFromMaterialRequestSchema.parse({
      learningId: params.learningId,
      materialId: params.materialId,
      materialText: typeof params.materialText === "string" ? params.materialText : undefined,
      materialTitle: typeof params.materialTitle === "string" ? params.materialTitle : undefined,
      types: normalizedTypes,
      presetId: params.presetId,
      presetTitle: params.presetTitle,
      presetSystemPrompt: params.presetSystemPrompt,
      presetUserTemplate: params.presetUserTemplate,
    });
    const learning = await fetchLearning(db, request.learningId, userId);
    if (!learning) {
      throw new ToolCallError("not_found", "learning not found", 404);
    }
    const { material, createdFromText } = await resolveMaterialForGeneration(
      db,
      env,
      request,
      learning,
      userId,
    );
    const preset = await resolvePresetContext(db, request, userId);
    const { drafts, meta } = await generateContentsFromMaterial(env, request, learning, material, preset);
    const items: GeneratedContent[] = [];
    for (const draft of drafts) {
      items.push(await saveGeneratedContent(db, { ...draft, userId }, userId, env));
    }
    const job = buildGenerationJob(request.types, preset, {
      modelName: meta.modelName,
      tokens: meta.tokens,
    });
    return { material, items, job, materialCreatedFromText: createdFromText };
  }

  if (tool === "save_content") {
    if (!db) throw new ToolCallError("db_unavailable", "Database is not available", 503);
    const input = {
      learningId: params.learningId,
      materialId: params.materialId,
      type: params.type,
      content: params.content,
      promptPreset: params.promptPreset,
    };
    const parsed = z
      .object({
        learningId: z.string().uuid(),
        materialId: z.string().uuid().optional(),
        type: schemas.generatedContent.shape.type,
        content: z.record(z.string(), z.unknown()),
        promptPreset: z.string().min(1).optional(),
      })
      .safeParse(input);
    if (!parsed.success) {
      throw new ToolCallError("invalid_params", JSON.stringify(parsed.error.format()));
    }
    const saved = await saveGeneratedContent(db, { ...parsed.data, userId }, userId, env);
    return { content: saved };
  }

  throw new ToolCallError("unsupported_tool", `tool "${tool}" is not supported`, 400);
};
