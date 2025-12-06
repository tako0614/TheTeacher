import type {
  AuthSessionResponse,
  GenerateFromMaterialRequest,
  GenerationResult,
  MaterialIngestRequest,
  MaterialIngestResult,
  GeneratedContent,
  Learning,
  Material,
  MaterialLibraryEntry,
  PracticeSession,
  Preset,
  User,
  UserSession,
  IngestJob,
} from "@theteacher/shared";

import { mockData } from "./mock-data";
import type { LearningSummary, SnapshotPayload, AuthSessionState } from "./types";

type MockStore = {
  learnings: Learning[];
  materials: Material[];
  generatedContents: GeneratedContent[];
  practiceSessions: PracticeSession[];
  presets: Preset[];
  libraryEntries: MaterialLibraryEntry[];
  user: User;
  session: UserSession;
  token: string;
};

const clone = <T>(value: T): T =>
  typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));

const newId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `mock-${Math.random().toString(16).slice(2, 10)}`;

const nowIso = () => new Date().toISOString();

const createInitialStore = (): MockStore => ({
  learnings: [
    clone(mockData.learningMath),
    clone(mockData.learningEnglish),
  ],
  materials: [
    clone(mockData.materialPdf),
    clone(mockData.materialImage),
    clone(mockData.materialAudio),
    clone(mockData.materialEnglish),
  ],
  generatedContents: [
    clone(mockData.generatedSummary),
    clone(mockData.generatedQaEnglish),
    clone(mockData.generatedPracticeMath),
  ],
  practiceSessions: [clone(mockData.practiceSession)],
  presets: clone(mockData.presets),
  libraryEntries: clone(mockData.libraryEntries),
  user: clone(mockData.user),
  session: clone(mockData.userSession),
  token: mockData.authResponse.token,
});

let store = createInitialStore();

const summarizeLearning = (learning: Learning): LearningSummary => {
  const materials = store.materials.filter((item) => item.learningId === learning.id);
  const contents = store.generatedContents.filter((item) => item.learningId === learning.id);
  const sessions = store.practiceSessions
    .filter((item) => item.learningId === learning.id)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const lastStudiedAt = sessions[0]?.createdAt;
  return {
    ...learning,
    materialsCount: materials.length,
    generatedCount: contents.length,
    sessionCount: sessions.length,
    lastStudiedAt,
  };
};

const findLearning = (id: string) => store.learnings.find((item) => item.id === id);
const findMaterial = (id: string) => store.materials.find((item) => item.id === id);
const findContent = (id: string) => store.generatedContents.find((item) => item.id === id);

const ensureLearningExists = (id: string) => {
  const learning = findLearning(id);
  if (!learning) {
    throw new Error("learning_not_found");
  }
  return learning;
};

const saveLibraryEntry = (material: Material, payload?: MaterialIngestRequest["payload"]) => {
  const entry: MaterialLibraryEntry = {
    id: newId(),
    userId: store.user.id,
    displayName:
      payload?.fileName ??
      material.sourcePath ??
      `${material.type.toUpperCase()}_${material.id.slice(0, 8)}`,
    storedPath: material.sourcePath ?? material.id,
    assetPath: payload?.dataUrl ? material.sourcePath ?? `/${material.id}` : undefined,
    type: material.type,
    bytes: payload?.bytes,
    learningId: material.learningId,
    materialId: material.id,
    libraryPath: material.sourcePath ?? material.id,
    originalSource: payload?.text ? { kind: "text", text: payload.text } : undefined,
    createdAt: material.createdAt,
    updatedAt: material.updatedAt,
  };
  store.libraryEntries.push(entry);
  return entry;
};

const upsertMaterial = (input: Material): Material => {
  const existingIndex = store.materials.findIndex((item) => item.id === input.id);
  if (existingIndex >= 0) {
    store.materials[existingIndex] = input;
  } else {
    store.materials.push(input);
  }
  return input;
};

const upsertContent = (input: GeneratedContent): GeneratedContent => {
  const existingIndex = store.generatedContents.findIndex((item) => item.id === input.id);
  if (existingIndex >= 0) {
    store.generatedContents[existingIndex] = input;
  } else {
    store.generatedContents.push(input);
  }
  return input;
};

const removeGeneratedForMaterial = (materialId: string) => {
  store.generatedContents = store.generatedContents.filter((item) => item.materialId !== materialId);
};

export const mockApi = {
  reset() {
    store = createInitialStore();
  },

  async fetchAuthSession(): Promise<AuthSessionState> {
    return { user: clone(store.user), session: clone(store.session) };
  },

  async issueSession(): Promise<AuthSessionResponse> {
    const token = `mock_${newId()}`;
    store.token = token;
    return { user: clone(store.user), session: clone(store.session), token };
  },

  async fetchBillingPricing() {
    return {
      currency: "jpy",
      unitAmount: 1200,
      creditsPerPack: 120,
      effectiveCreditsPerPack: 120,
      minPricePerCredit: 12,
      label: "120 credits / JPY 12.0",
      priceId: "price_mock",
    };
  },

  async fetchBillingBalance() {
    return { credits: store.user.credits ?? 0 };
  },

  async createBillingCheckout() {
    return { url: "https://example.com/checkout" };
  },

  async updateUserProfile(input: { email?: string; displayName?: string }) {
    store.user = { ...store.user, ...input, updatedAt: nowIso() };
    return { user: clone(store.user) };
  },

  async fetchLearnings(params: { q?: string; subject?: string; tag?: string; limit?: number }) {
    const limit = params.limit ?? 50;
    const keyword = params.q?.toLowerCase().trim();
    const tag = params.tag?.toLowerCase().trim();
    const filtered = store.learnings.filter((learning) => {
      if (params.subject && learning.subject !== params.subject) return false;
      if (keyword) {
        const haystack = `${learning.title} ${learning.subject ?? ""} ${(learning.tags ?? []).join(" ")}`.toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      if (tag) {
        if (!learning.tags?.some((t) => t.toLowerCase().includes(tag))) return false;
      }
      return true;
    });
    return filtered.slice(0, limit).map((learning) => summarizeLearning(learning));
  },

  async fetchLearning(id: string) {
    const learning = findLearning(id);
    return learning ? summarizeLearning(learning) : null;
  },

  async createLearning(
    input: Pick<Learning, "title"> &
      Partial<Pick<Learning, "subject" | "tags" | "progress" | "id" | "createdAt" | "updatedAt">>,
  ) {
    const now = input.createdAt ?? nowIso();
    const learning: Learning = {
      id: input.id ?? newId(),
      userId: store.user.id,
      title: input.title,
      subject: input.subject,
      tags: input.tags,
      progress: input.progress,
      createdAt: now,
      updatedAt: input.updatedAt ?? now,
    };
    store.learnings.push(learning);
    return summarizeLearning(learning);
  },

  async updateLearning(id: string, input: Partial<Learning>) {
    const learning = ensureLearningExists(id);
    const updated: Learning = {
      ...learning,
      ...input,
      updatedAt: input.updatedAt ?? nowIso(),
    };
    store.learnings = store.learnings.map((item) => (item.id === id ? updated : item));
    return summarizeLearning(updated);
  },

  async deleteLearning(id: string) {
    store.learnings = store.learnings.filter((item) => item.id !== id);
    store.materials = store.materials.filter((item) => item.learningId !== id);
    store.generatedContents = store.generatedContents.filter((item) => item.learningId !== id);
    store.practiceSessions = store.practiceSessions.filter((item) => item.learningId !== id);
    store.libraryEntries = store.libraryEntries.filter((item) => item.learningId !== id);
    return { ok: true };
  },

  async fetchMaterials(learningId: string) {
    return store.materials.filter((item) => item.learningId === learningId).map((item) => clone(item));
  },

  async fetchMaterial(id: string) {
    const material = findMaterial(id);
    return material ? clone(material) : null;
  },

  async fetchMaterialLibrary(params?: { learningId?: string; limit?: number }) {
    const limit = params?.limit ?? 50;
    const items = store.libraryEntries.filter((entry) =>
      params?.learningId ? entry.learningId === params.learningId : true,
    );
    return items.slice(0, limit).map((item) => clone(item));
  },

  async fetchIngestJobs(params?: { learningId?: string; limit?: number }) {
    const items: IngestJob[] = [];
    const limit = params?.limit ?? 50;
    const filtered = items.filter((job) =>
      params?.learningId ? job.learningId === params.learningId : true,
    );
    return { items: filtered.slice(0, limit), count: filtered.length };
  },

  async ingestMaterial(
    input: MaterialIngestRequest & { learningId: string },
  ): Promise<MaterialIngestResult> {
    const learning = ensureLearningExists(input.learningId);
    const id = newId();
    const createdAt = nowIso();
    const type = input.source.kind as Material["type"];
    const rawContent =
      input.payload?.text ??
      (input.source.kind === "text"
        ? input.source.text
        : input.source.kind === "url"
          ? input.source.url
          : input.source.path ?? `${input.source.kind}://${id}`);
    const material: Material = {
      id,
      userId: store.user.id,
      learningId: learning.id,
      type,
      sourcePath: input.source.kind === "url" ? input.source.url : input.source.path ?? rawContent,
      rawContent,
      metadata: {
        ingestSource: input.source,
        payloadFileName: input.payload?.fileName,
        payloadBytes: input.payload?.bytes,
        payloadMimeType: input.payload?.mimeType,
      },
      createdAt,
      updatedAt: createdAt,
    };
    upsertMaterial(material);
    saveLibraryEntry(material, input.payload);
    const job = {
      id: newId(),
      learningId: learning.id,
      source: input.source,
      status: "completed" as const,
      requestedAt: createdAt,
      updatedAt: createdAt,
      steps: [
        { id: "chunk", label: "チャンク生成", kind: "chunking", status: "succeeded" as const },
        { id: "embed", label: "埋め込み", kind: "embedding", status: "succeeded" as const },
      ],
    };
    const extracted = rawContent
      ? {
          preview: rawContent.slice(0, 160),
          tokens: rawContent.split(/\s+/).filter(Boolean).length,
          format: type === "audio" || type === "video" ? ("transcript" as const) : ("plain" as const),
        }
      : undefined;
    return { material: clone(material), job, extracted };
  },

  async createMaterial(
    input: Omit<Material, "id" | "createdAt" | "updatedAt"> &
      Partial<Pick<Material, "id" | "createdAt" | "updatedAt">>,
  ) {
    const now = input.createdAt ?? nowIso();
    const material: Material = {
      id: input.id ?? newId(),
      userId: store.user.id,
      learningId: input.learningId,
      type: input.type,
      sourcePath: input.sourcePath,
      rawContent: input.rawContent,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: input.updatedAt ?? now,
    };
    upsertMaterial(material);
    return clone(material);
  },

  async updateMaterial(id: string, input: Partial<Omit<Material, "id" | "learningId">>) {
    const material = findMaterial(id);
    if (!material) throw new Error("material_not_found");
    const updated: Material = {
      ...material,
      ...input,
      updatedAt: input.updatedAt ?? nowIso(),
    };
    upsertMaterial(updated);
    return clone(updated);
  },

  async deleteMaterial(id: string) {
    store.materials = store.materials.filter((item) => item.id !== id);
    removeGeneratedForMaterial(id);
    store.libraryEntries = store.libraryEntries.filter((entry) => entry.materialId !== id);
    return { ok: true };
  },

  async fetchContents(learningId: string) {
    return store.generatedContents
      .filter((item) => item.learningId === learningId)
      .map((item) => clone(item));
  },

  async createContent(
    input: Omit<GeneratedContent, "id" | "createdAt"> &
      Partial<Pick<GeneratedContent, "id" | "createdAt">>,
  ) {
    const content: GeneratedContent = {
      id: input.id ?? newId(),
      userId: store.user.id,
      learningId: input.learningId,
      materialId: input.materialId,
      type: input.type,
      content: input.content,
      promptPreset: input.promptPreset,
      createdAt: input.createdAt ?? nowIso(),
    };
    upsertContent(content);
    return clone(content);
  },

  async deleteContent(id: string) {
    store.generatedContents = store.generatedContents.filter((item) => item.id !== id);
    return { ok: true };
  },

  async generateFromMaterial(input: GenerateFromMaterialRequest): Promise<GenerationResult> {
    const learning = ensureLearningExists(input.learningId);
    let material = input.materialId ? findMaterial(input.materialId) ?? null : null;
    if (!material && input.materialText) {
      material = await this.createMaterial({
        id: newId(),
        learningId: learning.id,
        type: "text",
        sourcePath: input.materialTitle ?? "prompt.txt",
        rawContent: input.materialText,
      });
    }
    if (!material) {
      material = store.materials.find((m) => m.learningId === learning.id) ?? store.materials[0];
    }
    const createdAt = nowIso();
    const baseTitle = input.materialTitle ?? material?.sourcePath ?? learning.title;

    const buildContentPayload = (type: GeneratedContent["type"]): Record<string, unknown> => {
      const previewSource =
        material?.rawContent ?? input.materialText ?? learning.title ?? "生成コンテンツ";
      if (type === "qa") {
        return {
          title: `${baseTitle} / 一問一答`,
          preview: previewSource.slice(0, 120),
          qaPairs: [
            {
              question: `${baseTitle}の要点は？`,
              answer: previewSource.slice(0, 80) || "要点をまとめました。",
              rationale: "本文から主要なポイントを抽出しています。",
            },
            {
              question: `${baseTitle}で学ぶ公式やキーワードは？`,
              answer: "軸: -b/2a, 頂点: f(-b/2a) などを整理。",
            },
          ],
        };
      }
      if (type === "practice") {
        return {
          title: `${baseTitle} / 練習問題`,
          preview: "短答式の計算問題と頂点計算を含む2問セット",
          practiceItems: [
            {
              prompt: "y = 2x^2 - 4x + 1 の軸を求めよ。",
              expectedAnswer: "x = 1",
              hint: "軸は -b/2a を用いる。",
              difficulty: "easy",
            },
            {
              prompt: "y = -x^2 + 6x - 5 の頂点座標を求めよ。",
              expectedAnswer: "(3,4)",
              hint: "平方完成で (x-3)^2 の形にする。",
              difficulty: "medium",
            },
          ],
        };
      }
      if (type === "summary") {
        return {
          title: `${baseTitle} / 要約`,
          preview: previewSource.slice(0, 160),
          blocks: [{ type: "text", variant: "paragraph", text: previewSource.slice(0, 200) }],
        };
      }
      return { preview: previewSource.slice(0, 120) };
    };

    const items: GeneratedContent[] = (input.types ?? ["qa"]).map((type, index) => {
      const content: GeneratedContent = {
        id: newId(),
        userId: store.user.id,
        learningId: learning.id,
        materialId: material?.id,
        type,
        content: buildContentPayload(type),
        promptPreset: input.presetId ?? input.presetTitle ?? undefined,
        createdAt,
      };
      upsertContent(content);
      return content;
    });

    const job: GenerationResult["job"] = {
      createdAt,
      completedAt: createdAt,
      presetTitle: input.presetTitle ?? input.presetId,
      types: input.types ?? ["qa"],
      notes: "mock_generation",
    };

    return {
      material: material ? clone(material) : undefined,
      job,
      items: items.map((item) => clone(item)),
    };
  },

  async requestTtsGeneration() {
    return { status: "queued" as const };
  },

  async fetchSessions(learningId: string) {
    return store.practiceSessions
      .filter((item) => item.learningId === learningId)
      .map((item) => clone(item));
  },

  async createSession(
    input: Omit<PracticeSession, "id" | "createdAt"> &
      Partial<Pick<PracticeSession, "id" | "createdAt">>,
  ) {
    const session: PracticeSession = {
      id: input.id ?? newId(),
      userId: store.user.id,
      learningId: input.learningId,
      generatedContentId: input.generatedContentId,
      questionRef: input.questionRef,
      answerText: input.answerText,
      isCorrect: input.isCorrect,
      feedback: input.feedback,
      score: input.score,
      createdAt: input.createdAt ?? nowIso(),
    };
    store.practiceSessions.push(session);
    return clone(session);
  },

  async fetchPresets(params?: { subject?: string; limit?: number }) {
    const items = store.presets.filter((preset) =>
      params?.subject ? preset.subject === params.subject : true,
    );
    return items.slice(0, params?.limit ?? items.length).map((item) => clone(item));
  },

  async createPreset(
    input: Omit<Preset, "id" | "createdAt" | "updatedAt"> &
      Partial<Pick<Preset, "id" | "createdAt" | "updatedAt">>,
  ) {
    const now = input.createdAt ?? nowIso();
    const preset: Preset = {
      id: input.id ?? newId(),
      userId: store.user.id,
      subject: input.subject,
      title: input.title,
      systemPrompt: input.systemPrompt,
      userInstructionTemplate: input.userInstructionTemplate,
      createdAt: now,
      updatedAt: input.updatedAt ?? now,
    };
    store.presets.push(preset);
    return clone(preset);
  },

  async updatePreset(id: string, input: Partial<Preset>) {
    const preset = store.presets.find((item) => item.id === id);
    if (!preset) throw new Error("preset_not_found");
    const updated: Preset = {
      ...preset,
      ...input,
      updatedAt: input.updatedAt ?? nowIso(),
    };
    store.presets = store.presets.map((item) => (item.id === id ? updated : item));
    return clone(updated);
  },

  async deletePreset(id: string) {
    store.presets = store.presets.filter((item) => item.id !== id);
    return { ok: true };
  },

  async fetchSnapshot(): Promise<SnapshotPayload> {
    return {
      learnings: clone(store.learnings),
      materials: clone(store.materials),
      generatedContents: clone(store.generatedContents),
      practiceSessions: clone(store.practiceSessions),
    };
  },

  async replaceSnapshot(snapshot: SnapshotPayload) {
    store.learnings = clone(snapshot.learnings);
    store.materials = clone(snapshot.materials);
    store.generatedContents = clone(snapshot.generatedContents);
    store.practiceSessions = clone(snapshot.practiceSessions);
    // Clean up dependent data
    const learningIds = new Set(store.learnings.map((item) => item.id));
    store.libraryEntries = store.libraryEntries.filter((entry) => learningIds.has(entry.learningId ?? ""));
  },
};
