import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fixtures } from "./test/fixtures";
import App from "./App";

vi.mock("./lib/auth", () => ({
  readSessionToken: vi.fn(() => fixtures.authResponse.token),
  persistSessionToken: vi.fn(() => fixtures.authResponse.token),
  clearSessionToken: vi.fn(),
  ensureSessionToken: vi.fn(async () => fixtures.authResponse.token),
  bootstrapAnonymousSession: vi.fn(async () => fixtures.authResponse),
  exchangeGoogleIdToken: vi.fn(async () => fixtures.authResponse),
}));

vi.mock("./lib/google-auth", () => ({
  getGoogleIdToken: vi.fn(async () => "google-id-token"),
}));

vi.mock("./lib/api-client", () => ({
  fetchAuthSession: vi.fn(async () => ({
    user: fixtures.user,
    session: fixtures.userSession,
  })),
  issueSession: vi.fn(async () => fixtures.authResponse),
  loginWithGoogle: vi.fn(async () => fixtures.authResponse),
  updateUserProfile: vi.fn(async () => ({ user: fixtures.user })),
  fetchLearnings: vi.fn(async () => [fixtures.learningSummary]),
  fetchLearning: vi.fn(async (id: string) => ({ ...fixtures.learningSummary, id })),
  createLearning: vi.fn(async (input) => ({
    ...fixtures.learningSummary,
    ...input,
    id: input.id ?? "learning-created",
  })),
  updateLearning: vi.fn(async (id: string, input) => ({ ...fixtures.learningSummary, ...input, id })),
  deleteLearning: vi.fn(async () => ({ ok: true })),
  fetchMaterials: vi.fn(async () => ({ items: [fixtures.material] })),
  fetchMaterial: vi.fn(async () => fixtures.material),
  createMaterial: vi.fn(async (input) => ({
    ...fixtures.material,
    ...input,
    id: input.id ?? fixtures.material.id,
    createdAt: input.createdAt ?? fixtures.material.createdAt,
    updatedAt: input.updatedAt ?? fixtures.material.updatedAt,
  })),
  updateMaterial: vi.fn(async (id: string, input) => ({ ...fixtures.material, ...input, id })),
  deleteMaterial: vi.fn(async () => ({ ok: true })),
  fetchMaterialLibrary: vi.fn(async () => [fixtures.libraryEntry]),
  ingestMaterial: vi.fn(async () => ({
    material: fixtures.material,
    job: {
      id: "ingest-1",
      source: { kind: "text", text: "mock" },
      status: "queued",
      steps: [
        {
          id: "chunk",
          label: "chunk",
          kind: "chunking",
          status: "succeeded",
          startedAt: fixtures.now,
          finishedAt: fixtures.now,
        },
      ],
      requestedAt: fixtures.now,
      updatedAt: fixtures.now,
    },
    extracted: { preview: "mock preview" },
  })),
  fetchContents: vi.fn(async () => ({ items: [fixtures.generatedContent] })),
  createContent: vi.fn(async (input) => ({
    ...fixtures.generatedContent,
    ...input,
    id: input.id ?? fixtures.generatedContent.id,
    createdAt: input.createdAt ?? fixtures.generatedContent.createdAt,
  })),
  deleteContent: vi.fn(async () => ({ ok: true })),
  generateFromMaterial: vi.fn(async () => ({
    material: fixtures.material,
    job: {
      createdAt: fixtures.now,
      completedAt: fixtures.now,
      presetTitle: "math_default",
      types: ["qa"],
      notes: "mock job",
    },
    items: [fixtures.generatedContent],
  })),
  requestTtsGeneration: vi.fn(async () => ({ status: "queued" })),
  fetchSessions: vi.fn(async () => ({ items: [fixtures.practiceSession] })),
  createSession: vi.fn(async (input) => ({
    ...fixtures.practiceSession,
    ...input,
    id: input.id ?? "session-created",
    createdAt: input.createdAt ?? fixtures.now,
  })),
  fetchPresets: vi.fn(async () => fixtures.presets),
  createPreset: vi.fn(async () => ({
    id: "preset-created",
    subject: "math",
    title: "Created",
    systemPrompt: "Math",
    userInstructionTemplate: "Template",
    createdAt: fixtures.now,
    updatedAt: fixtures.now,
  })),
  updatePreset: vi.fn(async (id: string) => ({
    id,
    subject: "math",
    title: "Updated",
    systemPrompt: "Math",
    userInstructionTemplate: "Template",
    createdAt: fixtures.now,
    updatedAt: fixtures.now,
  })),
  deletePreset: vi.fn(async () => ({ ok: true })),
  fetchSnapshot: vi.fn(async () => fixtures.snapshot),
  replaceSnapshot: vi.fn(async () => {}),
}));

vi.mock("./lib/ai", async () => {
  const actual = await vi.importActual<typeof import("./lib/ai")>("./lib/ai");
  return {
    ...actual,
    semanticSearch: vi.fn(async (query: string, topK = 5, options) => {
      if (!query.trim()) return [];
      const filtered = fixtures.semanticMatches.filter((match) => {
        if (options?.refType && match.refType !== options.refType) return false;
        if (options?.subject && match.subject && match.subject !== options.subject) return false;
        return match.label.toLowerCase().includes(query.toLowerCase());
      });
      const pool = filtered.length > 0 ? filtered : fixtures.semanticMatches;
      return pool.slice(0, topK);
    }),
    proxyChat: vi.fn(async (prompt: string, opts?: { topK?: number }) => ({
      reply: `Mock reply for: ${prompt}`,
      toolCalls: [],
      related: fixtures.semanticMatches.slice(0, opts?.topK ?? 3),
      intent: "search",
    })),
    invokeTool: vi.fn(async (tool, params) => ({ tool, result: { ok: true, params } })),
  };
});

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

const surfaceTitles = [
  "学習一覧",
  "学習詳細",
  "演習",
  "汎用AIチャット",
  "教材設定",
  "過去教材から新しい学習作成",
  "設定",
];

describe("App navigation", () => {
  beforeAll(() => {
    // jsdom does not implement scrollTo but the router calls it on navigation
    window.scrollTo = vi.fn();
  });

  it("renders navigation links for each PLAN surface", () => {
    render(() => <App />);

    surfaceTitles.forEach((title) => {
      expect(
        screen.getByRole("link", { name: new RegExp(`^${title}`) }),
      ).toBeInTheDocument();
    });
  });

  it("navigates to surfaces when links are clicked", async () => {
    render(() => <App />);

    expect(
      screen.getByRole("heading", { name: "学習一覧" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /^汎用AIチャット/ }));
    expect(
      await screen.findByText("Tool Call ログ"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /^演習/ }));
    expect(await screen.findByText(/手書き入力/)).toBeInTheDocument();
  });

  it("shows surface-specific UI elements", async () => {
    render(() => <App />);

    expect(screen.getByPlaceholderText("タイトル・タグ検索")).toBeInTheDocument();
    expect(screen.getByText(/学習を作成/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /^学習詳細/ }));
    expect(await screen.findByText("生成履歴")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /^設定/ }));
    expect(await screen.findByText("教科プリセット")).toBeInTheDocument();
  });
});
