import {
  type GeneratedContent,
  type GeneratedContentType,
  type Learning,
  type Material,
  type MaterialType,
  type PracticeSession,
} from "@theteacher/shared";
import {
  createContext,
  createEffect,
  useContext,
  type ParentComponent,
} from "solid-js";
import { createStore, produce } from "solid-js/store";

const STORAGE_KEY = "theteacher/local-db/v1";

export type DbState = {
  learnings: Learning[];
  materials: Material[];
  generatedContents: GeneratedContent[];
  practiceSessions: PracticeSession[];
};

type CreateLearningInput = Pick<Learning, "title"> &
  Partial<Pick<Learning, "subject" | "tags">>;

type UpdateLearningInput = Partial<
  Pick<Learning, "title" | "subject" | "tags" | "progress">
>;

type CreateMaterialInput = Omit<Material, "id" | "createdAt" | "updatedAt">;
type UpdateMaterialInput = Partial<
  Pick<Material, "sourcePath" | "rawContent" | "metadata" | "type">
>;

type CreateGeneratedContentInput = Omit<
  GeneratedContent,
  "id" | "createdAt"
>;
type UpdateGeneratedContentInput = Partial<
  Pick<GeneratedContent, "content" | "promptPreset" | "materialId" | "type">
>;

type CreatePracticeSessionInput = Omit<
  PracticeSession,
  "id" | "createdAt"
>;
type UpdatePracticeSessionInput = Partial<
  Pick<
    PracticeSession,
    "answerText" | "feedback" | "isCorrect" | "score" | "questionRef"
  >
>;

const getStorage = () =>
  typeof localStorage === "undefined" ? null : localStorage;

const toIso = (value: string) => new Date(value).toISOString();

const seedState: DbState = {
  learnings: [
    {
      id: "8e3dfdc0-5510-4c12-9f60-7cba439b1dea",
      title: "高校数学I_二次関数_第1回",
      subject: "math",
      tags: ["二次関数", "基礎"],
      progress: 0.42,
      createdAt: toIso("2024-10-28T09:00:00Z"),
      updatedAt: toIso("2024-11-02T12:00:00Z"),
    },
    {
      id: "63a8e91f-1c40-4d73-8d8e-3a690c1da0e7",
      title: "英語長文_時制の一致",
      subject: "english",
      tags: ["読解", "文法"],
      progress: 0.68,
      createdAt: toIso("2024-10-20T13:30:00Z"),
      updatedAt: toIso("2024-11-01T01:45:00Z"),
    },
  ],
  materials: [
    {
      id: "bf8de7c6-5853-49d7-bb56-2b05b46d5c02",
      learningId: "8e3dfdc0-5510-4c12-9f60-7cba439b1dea",
      type: "pdf",
      sourcePath: "/samples/quadratic.pdf",
      rawContent:
        "二次関数の基礎と平方完成に関するページ抜粋。グラフの読み方と極値の求め方を解説。",
      metadata: { pages: 6, notes: "教科書PDF" },
      createdAt: toIso("2024-10-28T09:05:00Z"),
      updatedAt: toIso("2024-10-28T09:05:00Z"),
    },
    {
      id: "3e0a05de-5d8f-4f2a-8e3a-4b37b2f4558b",
      learningId: "8e3dfdc0-5510-4c12-9f60-7cba439b1dea",
      type: "text",
      sourcePath: "/notes/quadratic.txt",
      rawContent:
        "平方完成の例題と軸/頂点の導出手順メモ。演習問題3問。",
      metadata: { note: "手打ちメモ" },
      createdAt: toIso("2024-10-29T02:15:00Z"),
      updatedAt: toIso("2024-10-29T02:15:00Z"),
    },
    {
      id: "4991289e-689e-4d9b-9c40-0f283e2d3bd3",
      learningId: "63a8e91f-1c40-4d73-8d8e-3a690c1da0e7",
      type: "pdf",
      sourcePath: "/samples/english-tense.pdf",
      rawContent: "英文読解プリント。時制の一致に関する演習問題5問。",
      metadata: { pages: 4 },
      createdAt: toIso("2024-10-20T14:00:00Z"),
      updatedAt: toIso("2024-10-20T14:00:00Z"),
    },
  ],
  generatedContents: [
    {
      id: "18b33a10-8528-4e53-8b1b-717f27a5a2c3",
      learningId: "8e3dfdc0-5510-4c12-9f60-7cba439b1dea",
      materialId: "3e0a05de-5d8f-4f2a-8e3a-4b37b2f4558b",
      type: "qa",
      content: {
        title: "平方完成チェック",
        preview: "f(x)=x^2+4x+5 の頂点と最小値を確認する3問セット",
      },
      promptPreset: "math_detail",
      createdAt: toIso("2024-11-02T12:10:00Z"),
    },
    {
      id: "86a9ffd4-5b10-4f17-9f6d-017fbd7edc5c",
      learningId: "8e3dfdc0-5510-4c12-9f60-7cba439b1dea",
      materialId: "bf8de7c6-5853-49d7-bb56-2b05b46d5c02",
      type: "practice",
      content: {
        title: "基本計算セット",
        preview: "軸と頂点、判別式の扱いを含む3問セット",
      },
      promptPreset: "math_detail",
      createdAt: toIso("2024-11-02T12:20:00Z"),
    },
    {
      id: "3d536183-7b7a-4c86-b837-f2d35b9f1af7",
      learningId: "8e3dfdc0-5510-4c12-9f60-7cba439b1dea",
      materialId: "bf8de7c6-5853-49d7-bb56-2b05b46d5c02",
      type: "summary",
      content: {
        title: "要約 v2",
        preview: "基本形とグラフ変形のポイントを短く整理",
      },
      promptPreset: "math_detail",
      createdAt: toIso("2024-10-30T18:20:00Z"),
    },
    {
      id: "b7e3a736-6e0f-4dfd-9fb0-1b5e26563185",
      learningId: "63a8e91f-1c40-4d73-8d8e-3a690c1da0e7",
      materialId: "4991289e-689e-4d9b-9c40-0f283e2d3bd3",
      type: "qa",
      content: {
        title: "時制の一致Q&A",
        preview: "時制の一致を判断する短答式のセット",
      },
      promptPreset: "english_reading",
      createdAt: toIso("2024-11-01T01:30:00Z"),
    },
  ],
  practiceSessions: [
    {
      id: "db25d204-ad0f-46d5-8d7f-5cc0eb3b296e",
      learningId: "8e3dfdc0-5510-4c12-9f60-7cba439b1dea",
      generatedContentId: "86a9ffd4-5b10-4f17-9f6d-017fbd7edc5c",
      questionRef: { title: "軸と頂点", idx: 1 },
      answerText: "頂点(-2,1)、軸 x=-2",
      isCorrect: true,
      feedback: { message: "手順も正しいです" },
      score: 0.9,
      createdAt: toIso("2024-11-02T12:45:00Z"),
    },
    {
      id: "32b58a6d-e135-4c73-8eb8-44ed4d03f5d4",
      learningId: "8e3dfdc0-5510-4c12-9f60-7cba439b1dea",
      generatedContentId: "86a9ffd4-5b10-4f17-9f6d-017fbd7edc5c",
      questionRef: { title: "最小値の確認", idx: 2 },
      answerText: "最小値 1",
      isCorrect: true,
      feedback: { message: "式変形の説明を追加するとより良いです" },
      score: 0.8,
      createdAt: toIso("2024-11-02T12:55:00Z"),
    },
    {
      id: "38a02dae-5fb6-4e8d-98d8-9fc40c34be69",
      learningId: "63a8e91f-1c40-4d73-8d8e-3a690c1da0e7",
      generatedContentId: "b7e3a736-6e0f-4dfd-9fb0-1b5e26563185",
      questionRef: { title: "一致の位置", idx: 1 },
      answerText: "時制の一致で過去完了を選択",
      isCorrect: false,
      feedback: { message: "文脈が仮定法なので一致は不要" },
      score: 0.4,
      createdAt: toIso("2024-11-01T02:00:00Z"),
    },
  ],
};

const loadState = (): DbState => {
  const storage = getStorage();
  if (!storage) return seedState;

  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return seedState;

  try {
    const parsed = JSON.parse(raw) as DbState;
    if (!parsed.learnings || !parsed.materials) throw new Error("invalid db");
    return parsed;
  } catch (error) {
    console.warn("Failed to parse local db, falling back to seed.", error);
    return seedState;
  }
};

const persistState = (state: DbState) => {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
};

const nowIso = () => new Date().toISOString();

export const createLocalDb = () => {
  const [db, setDb] = createStore<DbState>(loadState());

  createEffect(() => {
    persistState(db);
  });

  const mutate = (updater: (draft: DbState) => void) =>
    setDb(produce(updater));

  const addLearning = (input: CreateLearningInput) => {
    const learning: Learning = {
      id: crypto.randomUUID(),
      title: input.title.trim(),
      subject: input.subject?.trim() || undefined,
      tags: input.tags?.map((tag) => tag.trim()).filter(Boolean),
      progress: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    mutate((draft) => {
      draft.learnings.unshift(learning);
    });
    return learning;
  };

  const updateLearning = (id: string, input: UpdateLearningInput) =>
    mutate((draft) => {
      const target = draft.learnings.find((item) => item.id === id);
      if (!target) return;
      Object.assign(target, input, { updatedAt: nowIso() });
    });

  const deleteLearning = (id: string) =>
    mutate((draft) => {
      draft.learnings = draft.learnings.filter((item) => item.id !== id);
      draft.materials = draft.materials.filter(
        (material) => material.learningId !== id,
      );
      draft.generatedContents = draft.generatedContents.filter(
        (content) => content.learningId !== id,
      );
      draft.practiceSessions = draft.practiceSessions.filter(
        (session) => session.learningId !== id,
      );
    });

  const addMaterial = (input: CreateMaterialInput) => {
    const material: Material = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    mutate((draft) => {
      draft.materials.unshift(material);
    });
    return material;
  };

  const updateMaterial = (id: string, input: UpdateMaterialInput) =>
    mutate((draft) => {
      const material = draft.materials.find((item) => item.id === id);
      if (!material) return;
      Object.assign(material, input, { updatedAt: nowIso() });
    });

  const deleteMaterial = (id: string) =>
    mutate((draft) => {
      const material = draft.materials.find((item) => item.id === id);
      if (!material) return;
      draft.materials = draft.materials.filter((item) => item.id !== id);
      draft.generatedContents = draft.generatedContents.filter(
        (content) => content.materialId !== id,
      );
    });

  const addGeneratedContent = (input: CreateGeneratedContentInput) => {
    const content: GeneratedContent = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: nowIso(),
    };
    mutate((draft) => {
      draft.generatedContents.unshift(content);
    });
    return content;
  };

  const updateGeneratedContent = (
    id: string,
    input: UpdateGeneratedContentInput,
  ) =>
    mutate((draft) => {
      const content = draft.generatedContents.find((item) => item.id === id);
      if (!content) return;
      Object.assign(content, input);
    });

  const deleteGeneratedContent = (id: string) =>
    mutate((draft) => {
      draft.generatedContents = draft.generatedContents.filter(
        (content) => content.id !== id,
      );
      draft.practiceSessions = draft.practiceSessions.filter(
        (session) => session.generatedContentId !== id,
      );
    });

  const addPracticeSession = (input: CreatePracticeSessionInput) => {
    const session: PracticeSession = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: nowIso(),
    };
    mutate((draft) => {
      draft.practiceSessions.unshift(session);
    });
    return session;
  };

  const updatePracticeSession = (
    id: string,
    input: UpdatePracticeSessionInput,
  ) =>
    mutate((draft) => {
      const session = draft.practiceSessions.find((item) => item.id === id);
      if (!session) return;
      Object.assign(session, input);
    });

  const deletePracticeSession = (id: string) =>
    mutate((draft) => {
      draft.practiceSessions = draft.practiceSessions.filter(
        (session) => session.id !== id,
      );
    });

  const replaceState = (next: DbState) => setDb(next);

  return {
    db,
    addLearning,
    updateLearning,
    deleteLearning,
    addMaterial,
    updateMaterial,
    deleteMaterial,
    addGeneratedContent,
    updateGeneratedContent,
    deleteGeneratedContent,
    addPracticeSession,
    updatePracticeSession,
    deletePracticeSession,
    replaceState,
  };
};

export const selectLearningStats = (state: DbState, learningId: string) => {
  const contents = state.generatedContents.filter(
    (content) => content.learningId === learningId,
  );
  const sessions = state.practiceSessions.filter(
    (session) => session.learningId === learningId,
  );

  const counts = contents.reduce(
    (acc, item) => {
      const key = item.type;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {} as Record<GeneratedContentType, number>,
  );

  const latestGenerated = contents[0]?.createdAt;
  const latestSession = sessions[0]?.createdAt;
  const lastStudied = latestSession ?? latestGenerated ?? null;

  const progressSamples = sessions
    .map((session) => session.score ?? (session.isCorrect ? 1 : 0))
    .filter((value): value is number => typeof value === "number");

  const practiceProgress =
    progressSamples.length > 0
      ? progressSamples.reduce((sum, value) => sum + value, 0) /
        progressSamples.length
      : null;

  return {
    generatedCounts: counts,
    lastStudied,
    progress: practiceProgress,
  };
};

const LocalDbContext = createContext<ReturnType<typeof createLocalDb>>();

export const LocalDbProvider: ParentComponent = (props) => {
  const store = createLocalDb();
  return (
    <LocalDbContext.Provider value={store}>
      {props.children}
    </LocalDbContext.Provider>
  );
};

export const useLocalDb = () => {
  const ctx = useContext(LocalDbContext);
  if (!ctx) {
    throw new Error("useLocalDb must be used within LocalDbProvider");
  }
  return ctx;
};
