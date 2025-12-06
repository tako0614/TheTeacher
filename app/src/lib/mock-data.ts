import type {
  AuthSessionResponse,
  GeneratedContent,
  Learning,
  Material,
  MaterialLibraryEntry,
  PracticeSession,
  Preset,
  User,
  UserSession,
} from "@theteacher/shared";

import { sampleLibraryEntries } from "./materials";
import type { LearningSummary, SnapshotPayload } from "./types";
import type { SemanticMatch } from "./ai";

const now = "2025-12-06T12:00:00.000Z";

const user: User = {
  id: "00000000-0000-4000-8000-000000000000",
  email: "demo@example.com",
  displayName: "デモユーザー",
  credits: 240,
  createdAt: now,
  updatedAt: now,
};

const userSession: UserSession = {
  id: "22222222-2222-4444-8888-222222222222",
  userId: user.id,
  deviceName: "vitest-mock",
  createdAt: now,
  updatedAt: now,
};

const learningMath: Learning = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "高校数学I_二次関数_第1回",
  subject: "math",
  tags: ["二次関数", "基礎"],
  progress: 0.6,
  createdAt: now,
  updatedAt: now,
};

const learningEnglish: Learning = {
  id: "33333333-3333-4333-8333-333333333333",
  title: "英語長文読解の基礎",
  subject: "english",
  tags: ["長文", "英語"],
  progress: 0.4,
  createdAt: now,
  updatedAt: now,
};

const materialPdf: Material = {
  id: "22222222-2222-2222-2222-222222222221",
  learningId: learningMath.id,
  type: "pdf",
  sourcePath: "materials/math/quadratic.pdf",
  rawContent: "二次関数の講義スライド全文 (PDF 抜粋)",
  metadata: { name: "二次関数_講義スライド.pdf", bytes: 2_485_000 },
  createdAt: now,
  updatedAt: now,
};

const materialImage: Material = {
  id: "22222222-2222-2222-2222-222222222222",
  learningId: learningMath.id,
  type: "image",
  sourcePath: "materials/math/board.png",
  rawContent: "板書スクリーンショット: 軸と頂点の求め方",
  metadata: { name: "板書_スクショ.png", bytes: 430_000 },
  createdAt: now,
  updatedAt: now,
};

const materialAudio: Material = {
  id: "22222222-2222-2222-2222-222222222223",
  learningId: learningMath.id,
  type: "audio",
  sourcePath: "materials/audio/podcast.wav",
  rawContent: "ポッドキャスト録音文字起こし (一部)",
  metadata: { name: "Podcast_試作.wav", bytes: 9_200_000 },
  createdAt: now,
  updatedAt: now,
};

const materialEnglish: Material = {
  id: "22222222-2222-4222-8222-222222222224",
  learningId: learningEnglish.id,
  type: "text",
  sourcePath: "notes/english-reading.md",
  rawContent: "長文読解のコツと設問アプローチをまとめたテキスト",
  metadata: { name: "英文読解ノート", bytes: 1200 },
  createdAt: now,
  updatedAt: now,
};

const generatedSummary: GeneratedContent = {
  id: "33333333-3333-4333-8333-333333333331",
  learningId: learningMath.id,
  materialId: materialPdf.id,
  type: "summary",
  content: { preview: "二次関数の概観", blocks: [] },
  promptPreset: "math_default",
  createdAt: now,
};

const generatedQaEnglish: GeneratedContent = {
  id: "33333333-3333-4333-8333-333333333332",
  learningId: learningEnglish.id,
  materialId: materialEnglish.id,
  type: "qa",
  content: {
    title: "長文読解の確認Q&A",
    qaPairs: [
      {
        question: "長文を読むときの最初のステップは？",
        answer: "設問を先に確認し、段落ごとの要点を意識する。",
        rationale: "設問を先に把握することで読み飛ばしを防ぎ、重要箇所に集中できます。",
      },
      {
        question: "時間が足りないときの優先順位は？",
        answer: "設問に直結する段落から読み、全体要約は後回しにする。",
      },
    ],
    preview: "長文読解の最初の一歩と時間配分のコツ",
  },
  promptPreset: "english_default",
  createdAt: now,
};

const generatedPracticeMath: GeneratedContent = {
  id: "33333333-3333-4333-8333-333333333333",
  learningId: learningMath.id,
  materialId: materialImage.id,
  type: "practice",
  content: {
    title: "二次関数 演習セット",
    practiceItems: [
      {
        prompt: "y = 2x^2 - 4x + 1 の軸を求めよ。",
        expectedAnswer: "x = 1",
        hint: "軸は -b/2a を使う。",
        difficulty: "easy",
      },
      {
        prompt: "y = -x^2 + 6x - 5 の頂点座標を求めよ。",
        expectedAnswer: "(3,4)",
        hint: "平方完成を用いる。",
        difficulty: "medium",
      },
    ],
    preview: "軸・頂点を求める2問セット",
  },
  promptPreset: "math_default",
  createdAt: now,
};

const practiceSession: PracticeSession = {
  id: "44444444-4444-4444-8444-444444444441",
  learningId: learningMath.id,
  generatedContentId: generatedPracticeMath.id,
  questionRef: { prompt: "軸を求めよ", expected: "x = -b/2a" },
  answerText: "x = -b/2a",
  isCorrect: true,
  feedback: { score: 1, verdict: "correct", comment: "OK" },
  score: 1,
  createdAt: now,
};

const libraryEntries: MaterialLibraryEntry[] = sampleLibraryEntries.map((entry) => ({
  ...entry,
  learningId: learningMath.id,
}));

const presets: Preset[] = [
  {
    id: "55555555-5555-4555-8555-555555555551",
    subject: "math",
    title: "Math Default",
    systemPrompt: "You are a math tutor",
    userInstructionTemplate: "解法をステップで示し、最後にポイントをまとめてください。",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "55555555-5555-4555-8555-555555555552",
    subject: "english",
    title: "English Reading",
    systemPrompt: "You are an English reading coach",
    userInstructionTemplate: "本文の要点と設問の意図を教えてください。",
    createdAt: now,
    updatedAt: now,
  },
];

const learningSummaries: LearningSummary[] = [learningMath, learningEnglish].map((learning) => {
  const materials = [materialPdf, materialImage, materialAudio, materialEnglish].filter((item) => item.learningId === learning.id);
  const contents = [generatedSummary, generatedQaEnglish, generatedPracticeMath].filter((item) => item.learningId === learning.id);
  const sessions = [practiceSession].filter((item) => item.learningId === learning.id);
  const lastStudiedAt = sessions[0]?.createdAt;
  return {
    ...learning,
    materialsCount: materials.length,
    generatedCount: contents.length,
    sessionCount: sessions.length,
    lastStudiedAt,
  };
});

const snapshot: SnapshotPayload = {
  learnings: [learningMath, learningEnglish],
  materials: [materialPdf, materialImage, materialAudio, materialEnglish],
  generatedContents: [generatedSummary, generatedQaEnglish, generatedPracticeMath],
  practiceSessions: [practiceSession],
};

const authResponse: AuthSessionResponse = {
  user,
  session: userSession,
  token: "token-mock-1234567890abcdef",
};

const semanticMatches: SemanticMatch[] = [
  {
    id: learningMath.id,
    label: learningMath.title,
    excerpt: materialPdf.rawContent ?? "",
    score: 0.9,
    refType: "learning",
    refId: learningMath.id,
    subject: learningMath.subject,
  },
  {
    id: generatedSummary.id,
    label: "生成コンテンツ: 要約",
    excerpt: "二次関数の概観",
    score: 0.82,
    refType: "generated_content",
    refId: generatedSummary.id,
    subject: learningMath.subject,
  },
  {
    id: generatedPracticeMath.id,
    label: "生成コンテンツ: 練習問題",
    excerpt: "軸と頂点を求める2問セット",
    score: 0.8,
    refType: "generated_content",
    refId: generatedPracticeMath.id,
    subject: learningMath.subject,
  },
  {
    id: practiceSession.id,
    label: "演習履歴: 軸を求めよ",
    excerpt: practiceSession.answerText ?? "",
    score: 0.78,
    refType: "question",
    refId: practiceSession.id,
    subject: learningMath.subject,
  },
];

export const mockData = {
  now,
  user,
  userSession,
  learningMath,
  learningEnglish,
  materialPdf,
  materialImage,
  materialAudio,
  materialEnglish,
  generatedSummary,
  generatedQaEnglish,
  generatedPracticeMath,
  practiceSession,
  libraryEntries,
  presets,
  learningSummaries,
  snapshot,
  authResponse,
  semanticMatches,
};
