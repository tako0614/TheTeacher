import type { AppSettings } from "@theteacher/shared";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import {
  createLearning,
  createSession,
  fetchLearnings,
  fetchPresets,
  fetchSnapshot,
  generateFromMaterial,
  ingestMaterial,
  replaceSnapshot,
} from "./api-client";
import { buildBackupSnapshot } from "./backup";
import * as http from "./http";
import { mockApi } from "./mock-api";
import { setPreferMock } from "./mock-mode";

describe("main study flow (mock integration)", () => {
  beforeEach(() => {
    mockApi.reset();
    setPreferMock(true);
  });

  afterEach(() => {
    setPreferMock(true);
    vi.restoreAllMocks();
  });

  it("runs import -> generate -> practice -> backup using mock data", async () => {
    const learning = await createLearning({ title: "統合フローの確認" });

    const ingestResult = await ingestMaterial({
      learningId: learning.id,
      source: { kind: "text", text: "二次関数の軸・頂点を整理する教材" },
    });
    expect(ingestResult.job.status).toBe("completed");
    expect(ingestResult.material.learningId).toBe(learning.id);

    const generation = await generateFromMaterial({
      learningId: learning.id,
      materialId: ingestResult.material.id,
      types: ["qa", "practice", "summary"],
      presetTitle: "math_default",
    });
    expect(generation.items.map((item) => item.type)).toEqual(
      expect.arrayContaining(["qa", "practice", "summary"]),
    );

    const practiceContent = generation.items.find((item) => item.type === "practice");
    const practiceItem = practiceContent
      ? ((practiceContent.content as { practiceItems?: { prompt: string; expectedAnswer?: string }[] })
          .practiceItems ?? [])[0]
      : undefined;

    const session = await createSession({
      learningId: learning.id,
      generatedContentId: practiceContent?.id,
      questionRef: practiceItem
        ? { prompt: practiceItem.prompt, expected: practiceItem.expectedAnswer }
        : { prompt: "復習問題" },
      answerText: "テスト回答",
      score: 0.5,
      isCorrect: false,
      feedback: {
        score: 0.5,
        verdict: "partial",
        comment: "mock feedback",
        reasoning: "mock reasoning",
      },
    });

    const snapshotDb = await fetchSnapshot();
    expect(snapshotDb.learnings.some((item) => item.id === learning.id)).toBe(true);
    expect(snapshotDb.generatedContents.some((item) => item.learningId === learning.id)).toBe(true);
    expect(snapshotDb.practiceSessions.some((item) => item.id === session.id)).toBe(true);

    const presets = await fetchPresets();
    const settings: AppSettings = {
      ai: { model: "gpt-4o-mini", temperature: 0.3 },
      backup: { strategy: "manual" },
    };
    const backup = buildBackupSnapshot(snapshotDb, settings, presets);
    expect(backup.db.materials.some((item) => item.learningId === learning.id)).toBe(true);

    // Restore only the newly created learning to verify replaceSnapshot clears stale data.
    const filteredSnapshot = {
      learnings: snapshotDb.learnings.filter((item) => item.id === learning.id),
      materials: snapshotDb.materials.filter((item) => item.learningId === learning.id),
      generatedContents: snapshotDb.generatedContents.filter((item) => item.learningId === learning.id),
      practiceSessions: snapshotDb.practiceSessions.filter((item) => item.learningId === learning.id),
    };
    await replaceSnapshot(filteredSnapshot);
    const restored = await fetchSnapshot();
    expect(restored.learnings.every((item) => item.id === learning.id)).toBe(true);
    expect(restored.materials.every((item) => item.learningId === learning.id)).toBe(true);
  });

  it("falls back to mock data when API requests fail", async () => {
    setPreferMock(false);
    const reqSpy = vi.spyOn(http, "requestJson").mockRejectedValue(new Error("network_down"));

    const learnings = await fetchLearnings({ limit: 3 });
    expect(learnings.length).toBeGreaterThan(0);
    expect(reqSpy).toHaveBeenCalled();

    reqSpy.mockRestore();
  });
});
