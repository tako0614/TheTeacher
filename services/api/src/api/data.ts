import type { Prisma } from "@prisma/client/edge";
import type { D1Database } from "@cloudflare/workers-types";
import type {
  GeneratedContent,
  Learning,
  Material,
  PracticeSession,
  Preset,
} from "@theteacher/shared";

import {
  parseJson,
  type GeneratedContentRow,
  type LearningWithStatsRow,
  type MaterialRow,
  type PracticeSessionRow,
  type PresetRow,
} from "../db";
import { DEFAULT_USER_ID } from "../core/auth";
import { getPrismaClient, nowIso } from "../core/prisma";
import type { AppBindings } from "../core/types";
import { indexLearningSemanticNode } from "./semantic";

const clampProgress = (value: number) => Math.max(0, Math.min(1, value));

export const mapLearning = (row: LearningWithStatsRow): Learning & {
  materialsCount: number;
  generatedCount: number;
  sessionCount: number;
  lastStudiedAt?: string;
} => {
  const createdAt =
    typeof row.createdAt === "string" ? row.createdAt : row.createdAt.toISOString();
  const updatedAt =
    typeof row.updatedAt === "string" ? row.updatedAt : row.updatedAt.toISOString();
  const lastStudied =
    row.lastStudiedAt === null || row.lastStudiedAt === undefined
      ? undefined
      : typeof row.lastStudiedAt === "string"
        ? row.lastStudiedAt
        : row.lastStudiedAt.toISOString();
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    subject: row.subject ?? undefined,
    tags:
      typeof row.tags === "string"
        ? parseJson<string[]>(row.tags)
        : (row.tags as unknown as string[] | undefined),
    progress: (row as { progress?: number | null }).progress ?? undefined,
    createdAt,
    updatedAt,
    materialsCount: (row as { materialsCount?: number }).materialsCount ?? 0,
    generatedCount: (row as { generatedCount?: number }).generatedCount ?? 0,
    sessionCount: (row as { sessionCount?: number }).sessionCount ?? 0,
    lastStudiedAt: lastStudied,
  };
};

export const mapMaterial = (row: MaterialRow): Material => ({
  id: row.id,
  userId: row.userId,
  learningId: row.learningId,
  type: row.type,
  sourcePath: row.sourcePath ?? undefined,
  rawContent: row.rawContent ?? undefined,
  metadata:
    typeof row.metadata === "string"
      ? parseJson<Record<string, unknown>>(row.metadata)
      : (row.metadata as unknown as Record<string, unknown> | undefined),
  createdAt: typeof row.createdAt === "string" ? row.createdAt : row.createdAt.toISOString(),
  updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : row.updatedAt.toISOString(),
});

export const mapGeneratedContent = (row: GeneratedContentRow): GeneratedContent => ({
  id: row.id,
  userId: row.userId,
  learningId: row.learningId,
  materialId: row.materialId ?? undefined,
  type: row.type,
  content:
    typeof row.content === "string"
      ? parseJson<Record<string, unknown>>(row.content) ?? {}
      : ((row.content as unknown as Record<string, unknown>) ?? {}),
  promptPreset: row.promptPreset ?? undefined,
  createdAt: typeof row.createdAt === "string" ? row.createdAt : row.createdAt.toISOString(),
});

export const mapPracticeSession = (row: PracticeSessionRow): PracticeSession => ({
  id: row.id,
  userId: row.userId,
  learningId: row.learningId,
  generatedContentId: row.generatedContentId ?? undefined,
  questionRef:
    typeof row.questionRef === "string"
      ? parseJson<Record<string, unknown>>(row.questionRef)
      : ((row.questionRef as unknown as Record<string, unknown>) ?? undefined),
  answerText: row.answerText,
  isCorrect: row.isCorrect === null ? undefined : Boolean(row.isCorrect),
  feedback:
    typeof row.feedback === "string"
      ? parseJson<Record<string, unknown>>(row.feedback)
      : ((row.feedback as unknown as Record<string, unknown>) ?? undefined),
  score: typeof row.score === "number" ? row.score : undefined,
  createdAt: typeof row.createdAt === "string" ? row.createdAt : row.createdAt.toISOString(),
});

export const mapPreset = (row: PresetRow): Preset => ({
  id: row.id,
  userId: row.userId,
  subject: row.subject,
  title: row.title,
  systemPrompt: row.systemPrompt,
  userInstructionTemplate: row.userInstructionTemplate,
  createdAt: typeof row.createdAt === "string" ? row.createdAt : row.createdAt.toISOString(),
  updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : row.updatedAt.toISOString(),
});

export const calculateLearningProgress = async (
  db: D1Database,
  learningId: string,
  userId: string,
) => {
  const prisma = getPrismaClient(db);
  const sessions = await prisma.practiceSession.findMany({
    where: { learningId, userId },
    select: { score: true, isCorrect: true },
  });
  if (!sessions.length) return undefined;
  const values = sessions
    .map((session) =>
      session.score !== null && session.score !== undefined
        ? session.score
        : session.isCorrect === null || session.isCorrect === undefined
          ? undefined
          : session.isCorrect
            ? 1
            : 0,
    )
    .filter((value): value is number => typeof value === "number");
  if (!values.length) return undefined;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return clampProgress(avg);
};

export const updateLearningProgress = async (db: D1Database, learningId: string, userId: string) => {
  const progress = await calculateLearningProgress(db, learningId, userId);
  if (progress === undefined) return;
  const prisma = getPrismaClient(db);
  await prisma.learning.update({
    where: { id: learningId },
    data: { progress, updatedAt: nowIso() },
  });
};

export const fetchMaterial = async (
  db: D1Database,
  id: string,
  userId: string = DEFAULT_USER_ID,
) => {
  const prisma = getPrismaClient(db);
  const row = await prisma.material.findUnique({ where: { id } });
  if (!row || row.userId !== userId) return null;
  return mapMaterial(row as unknown as MaterialRow);
};

export const applyMaterialMetadataPatch = async (
  db: D1Database,
  id: string,
  patch: (metadata: Record<string, unknown> | undefined) => Record<string, unknown> | undefined,
) => {
  const material = await fetchMaterial(db, id);
  if (!material) {
    throw new Error("material_not_found");
  }
  const nextMetadata = patch(material.metadata) ?? undefined;
  const updatedAt = nowIso();
  const prisma = getPrismaClient(db);
  await prisma.material.update({
    where: { id },
    data: {
      metadata: nextMetadata as unknown as Prisma.JsonValue,
      updatedAt,
    },
  });
  return {
    ...material,
    metadata: nextMetadata,
    updatedAt,
  };
};

export const fetchLatestMaterialForLearning = async (
  db: D1Database,
  learningId: string,
  userId: string = DEFAULT_USER_ID,
) => {
  const prisma = getPrismaClient(db);
  const row = await prisma.material.findFirst({
    where: { learningId, userId },
    orderBy: { updatedAt: "desc" },
  });
  return row ? mapMaterial(row as unknown as MaterialRow) : null;
};

export const fetchLearning = async (
  db: D1Database,
  id: string,
  userId: string = DEFAULT_USER_ID,
) => {
  const prisma = getPrismaClient(db);
  const learning = await prisma.learning.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          materials: true,
          generatedContents: true,
          practiceSessions: true,
        },
      },
      practiceSessions: {
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  if (!learning || learning.userId !== userId) return null;
  const lastStudied = learning.practiceSessions[0]?.createdAt;
  return mapLearning({
    ...learning,
    tags: learning.tags as unknown as string,
    materialsCount: learning._count.materials,
    generatedCount: learning._count.generatedContents,
    sessionCount: learning._count.practiceSessions,
    lastStudiedAt:
      lastStudied === null || lastStudied === undefined
        ? undefined
        : typeof lastStudied === "string"
          ? lastStudied
          : lastStudied.toISOString(),
  } as unknown as LearningWithStatsRow);
};

export const listLearnings = async (
  db: D1Database,
  params: { q?: string; subject?: string; tag?: string; limit: number },
  userId: string,
) => {
  const prisma = getPrismaClient(db);
  const where: Prisma.LearningWhereInput = {
    userId,
    ...(params.subject ? { subject: params.subject } : {}),
  };
  if (params.q) {
    where.OR = [
      { title: { contains: params.q, mode: "insensitive" } },
      { subject: { contains: params.q, mode: "insensitive" } },
    ];
  }
  const learnings = await prisma.learning.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: params.limit,
    include: {
      _count: {
        select: { materials: true, generatedContents: true, practiceSessions: true },
      },
      practiceSessions: {
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  const filtered = params.tag
    ? learnings.filter((learning) => {
        const tags = learning.tags;
        if (!tags) return false;
        if (Array.isArray(tags)) {
          return tags.some((tag) =>
            typeof tag === "string"
              ? tag.toLowerCase().includes(params.tag!.toLowerCase())
              : false,
          );
        }
        if (typeof tags === "string") {
          return tags.toLowerCase().includes(params.tag.toLowerCase());
        }
        return false;
      })
    : learnings;
  return filtered.map((learning) =>
    mapLearning({
      ...learning,
      tags: learning.tags as unknown as string,
      materialsCount: learning._count.materials,
      generatedCount: learning._count.generatedContents,
      sessionCount: learning._count.practiceSessions,
      lastStudiedAt:
        learning.practiceSessions[0]?.createdAt && typeof learning.practiceSessions[0]?.createdAt !== "string"
          ? learning.practiceSessions[0]!.createdAt!.toISOString()
          : learning.practiceSessions[0]?.createdAt,
    } as unknown as LearningWithStatsRow),
  );
};

export const insertLearning = async (
  db: D1Database,
  data: Pick<Learning, "title"> &
    Partial<Pick<Learning, "subject" | "tags" | "progress" | "id" | "createdAt" | "updatedAt">>,
  userId: string,
  env?: AppBindings,
): Promise<Learning> => {
  const id = data.id ?? crypto.randomUUID();
  const createdAt = data.createdAt ?? nowIso();
  const updatedAt = data.updatedAt ?? createdAt;
  const prisma = getPrismaClient(db);
  await prisma.learning.upsert({
    where: { id },
    create: {
      id,
      userId,
      title: data.title,
      subject: data.subject,
      tags: data.tags as unknown as Prisma.JsonValue,
      progress: data.progress,
      createdAt,
      updatedAt,
    },
    update: {
      title: data.title,
      subject: data.subject,
      tags: data.tags as unknown as Prisma.JsonValue,
      progress: data.progress,
      updatedAt,
    },
  });

  const learning = await fetchLearning(db, id, userId);
  const saved =
    learning ?? {
      id,
      userId,
      title: data.title,
      subject: data.subject,
      tags: data.tags,
      progress: data.progress,
      createdAt,
      updatedAt,
      materialsCount: 0,
      generatedCount: 0,
      sessionCount: 0,
    };
  await indexLearningSemanticNode(db, env, saved);
  return saved;
};

export const fetchPreset = async (
  db: D1Database,
  id: string,
  userId: string = DEFAULT_USER_ID,
) => {
  const prisma = getPrismaClient(db);
  const row = await prisma.preset.findUnique({ where: { id } });
  if (!row || row.userId !== userId) return null;
  return mapPreset(row as unknown as PresetRow);
};
