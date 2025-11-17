import type { D1Database } from "@cloudflare/workers-types";
import {
  generateFromMaterialRequestSchema,
  materialIngestResultSchema,
  schemas,
  type GenerateFromMaterialRequest,
  type GeneratedContent,
  type GenerationJob,
  type IngestJob,
  type IngestSource,
  type Learning,
  type Material,
  type MaterialIngestRequest,
  type PracticeSession,
  type Preset,
  type SemanticNode,
  refTypeSchema,
  ingestRequestSchema,
} from "@theteacher/shared";
import { Hono } from "hono";
import { z } from "zod";

import {
  parseJson,
  toJson,
  type GeneratedContentRow,
  type LearningWithStatsRow,
  type MaterialRow,
  type PracticeSessionRow,
  type PresetRow,
} from "./db";

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

const learningListQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  subject: z.string().trim().min(1).optional(),
  tag: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const presetListQuerySchema = z.object({
  subject: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const upsertLearningSchema = schemas.learning
  .pick({
    id: true,
    title: true,
    subject: true,
    tags: true,
    progress: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial({ id: true, progress: true, subject: true, tags: true, createdAt: true, updatedAt: true })
  .extend({
    title: z.string().min(1),
  });

const updateLearningSchema = upsertLearningSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: "at least one field is required" },
);

const upsertMaterialSchema = schemas.material
  .pick({
    id: true,
    learningId: true,
    type: true,
    sourcePath: true,
    rawContent: true,
    metadata: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial({ id: true, sourcePath: true, rawContent: true, metadata: true, createdAt: true, updatedAt: true })
  .extend({
    learningId: z.string().uuid(),
    type: schemas.material.shape.type,
  });

const updateMaterialSchema = upsertMaterialSchema
  .omit({ learningId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field is required",
  });

const ingestMaterialRequestSchema = ingestRequestSchema.extend({
  learningId: z.string().uuid(),
});

const upsertGeneratedSchema = schemas.generatedContent
  .pick({
    id: true,
    learningId: true,
    materialId: true,
    type: true,
    content: true,
    promptPreset: true,
    createdAt: true,
  })
  .partial({ id: true, materialId: true, promptPreset: true, createdAt: true })
  .extend({
    learningId: z.string().uuid(),
    type: schemas.generatedContent.shape.type,
    content: z.record(z.string(), z.unknown()),
  });

const upsertSessionSchema = schemas.practiceSession
  .pick({
    id: true,
    learningId: true,
    generatedContentId: true,
    questionRef: true,
    answerText: true,
    isCorrect: true,
    feedback: true,
    score: true,
    createdAt: true,
  })
  .partial({
    id: true,
    generatedContentId: true,
    isCorrect: true,
    feedback: true,
    score: true,
    questionRef: true,
    createdAt: true,
  })
  .extend({
    learningId: z.string().uuid(),
    answerText: z.string().min(1),
  });

const upsertPresetSchema = schemas.preset
  .pick({
    id: true,
    subject: true,
    title: true,
    systemPrompt: true,
    userInstructionTemplate: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial({ id: true, createdAt: true, updatedAt: true })
  .extend({
    subject: z.string().min(1),
    title: z.string().min(1),
    systemPrompt: z.string().min(1),
    userInstructionTemplate: z.string().min(1),
  });

const updatePresetSchema = upsertPresetSchema
  .omit({ id: true })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "at least one field is required",
  });

type AppBindings = {
  DB: D1Database;
};

type AppEnv = {
  Bindings: AppBindings;
};

export const app = new Hono<AppEnv>();

const nowIso = () => new Date().toISOString();

const mapLearning = (row: LearningWithStatsRow): Learning & {
  materialsCount: number;
  generatedCount: number;
  sessionCount: number;
  lastStudiedAt?: string;
} => ({
  id: row.id,
  title: row.title,
  subject: row.subject ?? undefined,
  tags: parseJson<string[]>(row.tags),
  progress: row.progress ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  materialsCount: row.materialsCount ?? 0,
  generatedCount: row.generatedCount ?? 0,
  sessionCount: row.sessionCount ?? 0,
  lastStudiedAt: row.lastStudiedAt ?? undefined,
});

const mapMaterial = (row: MaterialRow): Material => ({
  id: row.id,
  learningId: row.learningId,
  type: row.type,
  sourcePath: row.sourcePath ?? undefined,
  rawContent: row.rawContent ?? undefined,
  metadata: parseJson<Record<string, unknown>>(row.metadata),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const mapGeneratedContent = (row: GeneratedContentRow): GeneratedContent => ({
  id: row.id,
  learningId: row.learningId,
  materialId: row.materialId ?? undefined,
  type: row.type,
  content: parseJson<Record<string, unknown>>(row.content) ?? {},
  promptPreset: row.promptPreset ?? undefined,
  createdAt: row.createdAt,
});

const mapPracticeSession = (row: PracticeSessionRow): PracticeSession => ({
  id: row.id,
  learningId: row.learningId,
  generatedContentId: row.generatedContentId ?? undefined,
  questionRef: parseJson<Record<string, unknown>>(row.questionRef),
  answerText: row.answerText,
  isCorrect: row.isCorrect === null ? undefined : Boolean(row.isCorrect),
  feedback: parseJson<Record<string, unknown>>(row.feedback),
  score: typeof row.score === "number" ? row.score : undefined,
  createdAt: row.createdAt,
});

const mapPreset = (row: PresetRow): Preset => ({
  id: row.id,
  subject: row.subject,
  title: row.title,
  systemPrompt: row.systemPrompt,
  userInstructionTemplate: row.userInstructionTemplate,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const ingestStepTemplates: Record<
  IngestSource["kind"] | "fallback",
  IngestJob["steps"]
> = {
  pdf: [
    { id: "download", label: "ローカル保存", kind: "download", status: "pending" },
    { id: "ocr", label: "ページOCR", kind: "ocr", status: "pending" },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  image: [
    { id: "download", label: "ローカル保存", kind: "download", status: "pending" },
    { id: "ocr", label: "OCR", kind: "ocr", status: "pending" },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  audio: [
    { id: "download", label: "ローカル保存", kind: "download", status: "pending" },
    { id: "transcription", label: "文字起こし", kind: "transcription", status: "pending" },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  video: [
    { id: "download", label: "ローカル保存", kind: "download", status: "pending" },
    { id: "transcription", label: "音声抽出/文字起こし", kind: "transcription", status: "pending" },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  url: [
    { id: "download", label: "スクレイピング", kind: "download", status: "pending" },
    { id: "meta", label: "本文抽出", kind: "metadata", status: "pending" },
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  text: [
    { id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" },
    { id: "embed", label: "埋め込み", kind: "embedding", status: "pending" },
  ],
  fallback: [{ id: "chunk", label: "チャンク生成", kind: "chunking", status: "pending" }],
};

const fetchMaterial = async (db: D1Database, id: string) => {
  const row = await db
    .prepare("SELECT * FROM Material WHERE id = ? LIMIT 1")
    .bind(id)
    .first<MaterialRow>();
  return row ? mapMaterial(row) : null;
};

const fetchLatestMaterialForLearning = async (db: D1Database, learningId: string) => {
  const row = await db
    .prepare(
      "SELECT * FROM Material WHERE learningId = ? ORDER BY updatedAt DESC LIMIT 1",
    )
    .bind(learningId)
    .first<MaterialRow>();
  return row ? mapMaterial(row) : null;
};

const saveGeneratedContent = async (
  db: D1Database,
  data: Omit<GeneratedContent, "id" | "createdAt"> &
    Partial<Pick<GeneratedContent, "id" | "createdAt">>,
): Promise<GeneratedContent> => {
  const id = data.id ?? crypto.randomUUID();
  const createdAt = data.createdAt ?? nowIso();

  await db
    .prepare(
      `INSERT OR REPLACE INTO GeneratedContent (id, learningId, materialId, type, content, promptPreset, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      data.learningId,
      data.materialId ?? null,
      data.type,
      toJson(data.content),
      data.promptPreset ?? null,
      createdAt,
    )
    .run();

  const row = await db
    .prepare("SELECT * FROM GeneratedContent WHERE id = ? LIMIT 1")
    .bind(id)
    .first<GeneratedContentRow>();
  return row ? mapGeneratedContent(row) : { ...data, id, createdAt };
};

const summarizeText = (text: string, limit = 280) =>
  text.replace(/\s+/g, " ").trim().slice(0, limit);

const extractMaterialFromSource = (source: IngestSource) => {
  const base =
    source.kind === "text"
      ? source.text
      : source.kind === "url"
        ? `URLから抽出: ${source.url}`
        : `[${source.kind.toUpperCase()}] ${source.path}`;
  const tail =
    source.kind === "pdf"
      ? " PDFの本文をOCRして整形したサマリです。"
      : source.kind === "image"
        ? " 画像をOCRし、読み取った文字列を整形しました。"
        : source.kind === "audio" || source.kind === "video"
          ? " 音声を文字起こしし、要約した内容です。"
          : source.kind === "url"
            ? " 複数段落から主要部分を抽出しています。"
            : "";
  const rawContent = `${base}${tail}`.trim();
  const preview = summarizeText(rawContent);
  const format =
    source.kind === "image" || source.kind === "pdf"
      ? "ocr"
      : source.kind === "audio" || source.kind === "video"
        ? "transcript"
        : source.kind === "url"
          ? "scraped"
          : "plain";
  return {
    rawContent,
    extracted: {
      preview,
      tokens: rawContent.split(/\s+/).length,
      format,
    },
  };
};

const buildIngestJob = (
  request: MaterialIngestRequest,
  status: IngestJob["status"] = "completed",
): IngestJob => {
  const now = nowIso();
  const steps = (ingestStepTemplates[request.source.kind] ?? ingestStepTemplates.fallback).map(
    (step, index) => ({
      ...step,
      status: status === "completed" ? "succeeded" : index === 0 ? "running" : step.status,
      startedAt: status === "queued" ? undefined : now,
      finishedAt: status === "completed" ? now : undefined,
    }),
  );

  return {
    id: crypto.randomUUID(),
    learningId: request.learningId,
    source: request.source,
    status,
    requestedAt: now,
    updatedAt: now,
    preferredOcrEngine: request.ocrEngine,
    preferredTranscriptionEngine: request.transcriptionEngine,
    steps,
    notes: request.preferOffline ? "prefer_offline" : undefined,
    libraryPath: "TheTeacher/materials",
  };
};

const splitIdeas = (text: string, limit = 3) => {
  const sentences = text
    .split(/[。.!?]/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (sentences.length >= limit) return sentences.slice(0, limit);
  const words = text
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const joined = words.join(" ");
  return (sentences.length ? sentences : [joined]).slice(0, limit);
};

const buildGenerationJob = (
  types: GenerateFromMaterialRequest["types"],
  presetTitle?: string,
): GenerationJob => ({
  createdAt: nowIso(),
  completedAt: nowIso(),
  presetTitle,
  types,
  notes: presetTitle ? `preset="${presetTitle}"` : undefined,
});

const buildContentForType = (
  type: GeneratedContent["type"],
  ideas: string[],
  baseText: string,
  presetTitle?: string,
) => {
  const sourceTitle = presetTitle ?? "教材";
  if (type === "qa") {
    const pairs = ideas.map((idea, index) => ({
      question: `Q${index + 1}: ${summarizeText(idea, 64)} ?`,
      answer: idea,
      rationale: `教材から抽出: ${summarizeText(idea, 120)}`,
    }));
    return {
      title: `${sourceTitle} 一問一答`,
      preview: pairs[0]?.question ?? "教材の要点からQ&Aを生成しました。",
      pairs,
    };
  }

  if (type === "practice") {
    const items = ideas.map((idea, index) => ({
      prompt: `設問${index + 1}: ${summarizeText(idea, 72)}`,
      expectedAnswer: idea,
      hint: `キーワード: ${summarizeText(idea, 42)}`,
    }));
    return {
      title: `${sourceTitle} 練習問題`,
      preview: items[0]?.prompt ?? "教材から短答式の問題を生成しました。",
      items,
    };
  }

  if (type === "podcast_script") {
    const segments = ideas.map((idea, index) => ({
      speaker: index % 2 === 0 ? "Host" : "Guest",
      text: summarizeText(idea, 120),
    }));
    return {
      title: `${sourceTitle} ポッドキャスト用スクリプト`,
      preview: segments[0]?.text ?? "対話形式のスクリプトを生成しました。",
      segments,
    };
  }

  if (type === "summary") {
    const bullets = ideas.map((idea) => summarizeText(idea, 80));
    return {
      title: `${sourceTitle} 要約`,
      preview: bullets.join(" / ").slice(0, 140),
      bullets,
      summary: summarizeText(baseText, 320),
    };
  }

  return {
    title: `${sourceTitle} 生成コンテンツ`,
    preview: summarizeText(baseText, 80),
  };
};

const craftGeneratedContents = (
  request: GenerateFromMaterialRequest,
  material: Material | null,
): Array<Omit<GeneratedContent, "id" | "createdAt">> => {
  const baseText =
    material?.rawContent?.trim() ||
    material?.sourcePath ||
    "教材本文が未登録です。";
  const ideas = splitIdeas(baseText);

  return request.types.map((type) => ({
    learningId: request.learningId,
    materialId: material?.id,
    type,
    promptPreset: request.presetId ?? request.presetTitle,
    content: buildContentForType(
      type,
      ideas,
      baseText,
      request.presetTitle ?? request.presetUserTemplate,
    ),
  }));
};

const fetchLearning = async (db: D1Database, id: string) => {
  const result = await db
    .prepare(
      `SELECT l.*, 
        (SELECT COUNT(*) FROM Material m WHERE m.learningId = l.id) AS materialsCount,
        (SELECT COUNT(*) FROM GeneratedContent g WHERE g.learningId = l.id) AS generatedCount,
        (SELECT COUNT(*) FROM PracticeSession s WHERE s.learningId = l.id) AS sessionCount,
        (SELECT MAX(createdAt) FROM PracticeSession s2 WHERE s2.learningId = l.id) AS lastStudiedAt
      FROM Learning l WHERE l.id = ? LIMIT 1`,
    )
    .bind(id)
    .first<LearningWithStatsRow>();
  return result ? mapLearning(result) : null;
};

const fetchPreset = async (db: D1Database, id: string) => {
  const row = await db
    .prepare("SELECT * FROM Preset WHERE id = ? LIMIT 1")
    .bind(id)
    .first<PresetRow>();
  return row ? mapPreset(row) : null;
};

const buildLearningListQuery = (
  params: z.infer<typeof learningListQuerySchema>,
): { sql: string; binds: unknown[] } => {
  let sql = `SELECT l.*, 
    (SELECT COUNT(*) FROM Material m WHERE m.learningId = l.id) AS materialsCount,
    (SELECT COUNT(*) FROM GeneratedContent g WHERE g.learningId = l.id) AS generatedCount,
    (SELECT COUNT(*) FROM PracticeSession s WHERE s.learningId = l.id) AS sessionCount,
    (SELECT MAX(createdAt) FROM PracticeSession s2 WHERE s2.learningId = l.id) AS lastStudiedAt
    FROM Learning l WHERE 1=1`;
  const binds: unknown[] = [];

  if (params.subject) {
    sql += " AND l.subject = ?";
    binds.push(params.subject);
  }

  if (params.tag) {
    sql += " AND LOWER(COALESCE(l.tags, '')) LIKE ?";
    binds.push(`%${params.tag.toLowerCase()}%`);
  }

  if (params.q) {
    sql += " AND (LOWER(l.title) LIKE ? OR LOWER(COALESCE(l.tags, '')) LIKE ?)";
    const like = `%${params.q.toLowerCase()}%`;
    binds.push(like, like);
  }

  sql += " ORDER BY l.updatedAt DESC LIMIT ?";
  binds.push(params.limit);

  return { sql, binds };
};

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

app.get("/api/learnings", async (c) => {
  const query = Object.fromEntries(new URL(c.req.url).searchParams);
  const parsed = learningListQuerySchema.safeParse(query);
  if (!parsed.success) {
    return c.json({ error: "invalid_query", issues: parsed.error.format() }, 400);
  }

  const { sql, binds } = buildLearningListQuery(parsed.data);
  const rows = await c.env.DB.prepare(sql).bind(...binds).all<LearningWithStatsRow>();
  const items = rows.results?.map(mapLearning) ?? [];
  return c.json({ items, count: items.length });
});

app.get("/api/learnings/:id", async (c) => {
  const id = c.req.param("id");
  const learning = await fetchLearning(c.env.DB, id);
  if (!learning) return c.json({ error: "not_found" }, 404);
  return c.json(learning);
});

app.post("/api/learnings", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = upsertLearningSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const data = parsed.data;
  const id = data.id ?? crypto.randomUUID();
  const createdAt = data.createdAt ?? nowIso();
  const updatedAt = data.updatedAt ?? createdAt;

  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO Learning (id, title, subject, tags, progress, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      data.title,
      data.subject ?? null,
      toJson(data.tags),
      data.progress ?? null,
      createdAt,
      updatedAt,
    )
    .run();

  const learning = await fetchLearning(c.env.DB, id);
  return c.json(learning, 201);
});

app.put("/api/learnings/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updateLearningSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const exists = await fetchLearning(c.env.DB, id);
  if (!exists) return c.json({ error: "not_found" }, 404);

  const data = parsed.data;
  const updatedAt = data.updatedAt ?? nowIso();

  await c.env.DB.prepare(
    `UPDATE Learning SET
      title = COALESCE(?, title),
      subject = COALESCE(?, subject),
      tags = COALESCE(?, tags),
      progress = COALESCE(?, progress),
      updatedAt = ?
    WHERE id = ?`,
  )
    .bind(
      data.title ?? null,
      data.subject ?? null,
      data.tags ? toJson(data.tags) : null,
      data.progress ?? null,
      updatedAt,
      id,
    )
    .run();

  const learning = await fetchLearning(c.env.DB, id);
  return c.json(learning);
});

app.delete("/api/learnings/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM Learning WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

app.get("/api/learnings/:id/materials", async (c) => {
  const id = c.req.param("id");
  const rows = await c.env.DB
    .prepare("SELECT * FROM Material WHERE learningId = ? ORDER BY createdAt DESC")
    .bind(id)
    .all<MaterialRow>();
  const items = rows.results?.map(mapMaterial) ?? [];
  return c.json({ items });
});

app.post("/api/materials/ingest", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = ingestMaterialRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const request = parsed.data;
  const learning = await fetchLearning(c.env.DB, request.learningId);
  if (!learning) return c.json({ error: "learning_not_found" }, 404);

  const { rawContent, extracted } = extractMaterialFromSource(request.source);
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const updatedAt = createdAt;
  const type = request.source.kind as Material["type"];
  const sourcePath =
    request.source.kind === "url"
      ? request.source.url
      : request.source.kind === "text"
        ? summarizeText(request.source.text, 120)
        : request.source.path;

  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO Material (id, learningId, type, sourcePath, rawContent, metadata, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      request.learningId,
      type,
      sourcePath ?? null,
      rawContent ?? null,
      toJson({
        ingestSource: request.source,
        preferOffline: request.preferOffline ?? false,
      }),
      createdAt,
      updatedAt,
    )
    .run();

  const material =
    (await fetchMaterial(c.env.DB, id)) ??
    ({
      id,
      learningId: request.learningId,
      type,
      sourcePath: sourcePath ?? undefined,
      rawContent: rawContent ?? undefined,
      metadata: undefined,
      createdAt,
      updatedAt,
    } as Material);

  const job = buildIngestJob(request, "completed");
  return c.json(materialIngestResultSchema.parse({ material, job, extracted }), 201);
});

app.post("/api/materials", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = upsertMaterialSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const data = parsed.data;
  const id = data.id ?? crypto.randomUUID();
  const createdAt = data.createdAt ?? nowIso();
  const updatedAt = data.updatedAt ?? createdAt;

  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO Material (id, learningId, type, sourcePath, rawContent, metadata, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      data.learningId,
      data.type,
      data.sourcePath ?? null,
      data.rawContent ?? null,
      toJson(data.metadata),
      createdAt,
      updatedAt,
    )
    .run();

  const row = await c.env.DB
    .prepare("SELECT * FROM Material WHERE id = ? LIMIT 1")
    .bind(id)
    .first<MaterialRow>();
  return c.json(row ? mapMaterial(row) : null, 201);
});

app.put("/api/materials/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updateMaterialSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const exists = await fetchMaterial(c.env.DB, id);
  if (!exists) return c.json({ error: "not_found" }, 404);

  const data = parsed.data;
  const updatedAt = data.updatedAt ?? nowIso();

  await c.env.DB.prepare(
    `UPDATE Material SET
      type = COALESCE(?, type),
      sourcePath = COALESCE(?, sourcePath),
      rawContent = COALESCE(?, rawContent),
      metadata = COALESCE(?, metadata),
      updatedAt = ?
    WHERE id = ?`,
  )
    .bind(
      data.type ?? null,
      data.sourcePath ?? null,
      data.rawContent ?? null,
      data.metadata ? toJson(data.metadata) : null,
      updatedAt,
      id,
    )
    .run();

  const material = await fetchMaterial(c.env.DB, id);
  return c.json(material);
});

app.get("/api/learnings/:id/contents", async (c) => {
  const id = c.req.param("id");
  const rows = await c.env.DB
    .prepare("SELECT * FROM GeneratedContent WHERE learningId = ? ORDER BY createdAt DESC")
    .bind(id)
    .all<GeneratedContentRow>();
  const items = rows.results?.map(mapGeneratedContent) ?? [];
  return c.json({ items });
});

app.post("/api/contents", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = upsertGeneratedSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const data = parsed.data;
  const saved = await saveGeneratedContent(c.env.DB, data);
  return c.json(saved, 201);
});

app.post("/api/generate/from-material", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = generateFromMaterialRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const request = parsed.data;
  const learning = await fetchLearning(c.env.DB, request.learningId);
  if (!learning) return c.json({ error: "learning_not_found" }, 404);

  const material =
    request.materialId && request.materialId.length > 0
      ? await fetchMaterial(c.env.DB, request.materialId)
      : await fetchLatestMaterialForLearning(c.env.DB, request.learningId);

  if (request.materialId && !material) {
    return c.json({ error: "material_not_found" }, 404);
  }

  const drafts = craftGeneratedContents(request, material);
  const items: GeneratedContent[] = [];
  for (const draft of drafts) {
    items.push(await saveGeneratedContent(c.env.DB, draft));
  }

  const job = buildGenerationJob(request.types, request.presetTitle);
  return c.json({ material, job, items });
});

app.get("/api/learnings/:id/sessions", async (c) => {
  const id = c.req.param("id");
  const rows = await c.env.DB
    .prepare("SELECT * FROM PracticeSession WHERE learningId = ? ORDER BY createdAt DESC")
    .bind(id)
    .all<PracticeSessionRow>();
  const items = rows.results?.map(mapPracticeSession) ?? [];
  return c.json({ items });
});

app.post("/api/sessions", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = upsertSessionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const data = parsed.data;
  const id = data.id ?? crypto.randomUUID();
  const createdAt = data.createdAt ?? nowIso();

  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO PracticeSession (id, learningId, generatedContentId, questionRef, answerText, isCorrect, feedback, score, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      data.learningId,
      data.generatedContentId ?? null,
      toJson(data.questionRef),
      data.answerText,
      data.isCorrect === undefined ? null : data.isCorrect ? 1 : 0,
      toJson(data.feedback),
      data.score ?? null,
      createdAt,
    )
    .run();

  const row = await c.env.DB
    .prepare("SELECT * FROM PracticeSession WHERE id = ? LIMIT 1")
    .bind(id)
    .first<PracticeSessionRow>();
  return c.json(row ? mapPracticeSession(row) : null, 201);
});

app.get("/api/presets", async (c) => {
  const query = Object.fromEntries(new URL(c.req.url).searchParams);
  const parsed = presetListQuerySchema.safeParse(query);
  if (!parsed.success) {
    return c.json({ error: "invalid_query", issues: parsed.error.format() }, 400);
  }

  const binds: unknown[] = [];
  let sql = "SELECT * FROM Preset";
  if (parsed.data.subject) {
    sql += " WHERE subject = ?";
    binds.push(parsed.data.subject);
  }
  sql += " ORDER BY updatedAt DESC LIMIT ?";
  binds.push(parsed.data.limit);

  const rows = await c.env.DB.prepare(sql).bind(...binds).all<PresetRow>();
  const items = rows.results?.map(mapPreset) ?? [];
  return c.json({ items, count: items.length });
});

app.get("/api/presets/:id", async (c) => {
  const preset = await fetchPreset(c.env.DB, c.req.param("id"));
  if (!preset) return c.json({ error: "not_found" }, 404);
  return c.json(preset);
});

app.post("/api/presets", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = upsertPresetSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const data = parsed.data;
  const id = data.id ?? crypto.randomUUID();
  const createdAt = data.createdAt ?? nowIso();
  const updatedAt = data.updatedAt ?? createdAt;

  await c.env.DB.prepare(
    `INSERT OR REPLACE INTO Preset (id, subject, title, systemPrompt, userInstructionTemplate, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      data.subject,
      data.title,
      data.systemPrompt,
      data.userInstructionTemplate,
      createdAt,
      updatedAt,
    )
    .run();

  const preset = await fetchPreset(c.env.DB, id);
  return c.json(preset, 201);
});

app.put("/api/presets/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = updatePresetSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "invalid_request", issues: parsed.error.format() }, 400);
  }

  const exists = await fetchPreset(c.env.DB, id);
  if (!exists) return c.json({ error: "not_found" }, 404);

  const data = parsed.data;
  const updatedAt = data.updatedAt ?? nowIso();
  await c.env.DB.prepare(
    `UPDATE Preset SET
      subject = COALESCE(?, subject),
      title = COALESCE(?, title),
      systemPrompt = COALESCE(?, systemPrompt),
      userInstructionTemplate = COALESCE(?, userInstructionTemplate),
      updatedAt = ?
    WHERE id = ?`,
  )
    .bind(
      data.subject ?? null,
      data.title ?? null,
      data.systemPrompt ?? null,
      data.userInstructionTemplate ?? null,
      updatedAt,
      id,
    )
    .run();

  const preset = await fetchPreset(c.env.DB, id);
  return c.json(preset);
});

app.delete("/api/presets/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM Preset WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
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
