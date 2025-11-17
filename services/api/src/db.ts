import { type GeneratedContentType, type MaterialType } from "@theteacher/shared";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type LearningRow = {
  id: string;
  title: string;
  subject?: string | null;
  tags?: string | null;
  progress?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type MaterialRow = {
  id: string;
  learningId: string;
  type: MaterialType;
  sourcePath?: string | null;
  rawContent?: string | null;
  metadata?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GeneratedContentRow = {
  id: string;
  learningId: string;
  materialId?: string | null;
  type: GeneratedContentType;
  content: string;
  promptPreset?: string | null;
  createdAt: string;
};

export type PracticeSessionRow = {
  id: string;
  learningId: string;
  generatedContentId?: string | null;
  questionRef?: string | null;
  answerText: string;
  isCorrect?: number | null;
  feedback?: string | null;
  score?: number | null;
  createdAt: string;
};

export type PresetRow = {
  id: string;
  subject: string;
  title: string;
  systemPrompt: string;
  userInstructionTemplate: string;
  createdAt: string;
  updatedAt: string;
};

export type LearningWithStatsRow = LearningRow & {
  materialsCount: number;
  generatedCount: number;
  sessionCount: number;
  lastStudiedAt?: string | null;
};

export const parseJson = <T = JsonValue>(value?: string | null): T | undefined => {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
};

export const toJson = (value?: JsonValue) => (value === undefined ? null : JSON.stringify(value));
