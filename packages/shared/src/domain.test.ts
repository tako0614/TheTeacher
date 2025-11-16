import { describe, expect, it } from "vitest";
import {
  generatedContentSchema,
  learningSchema,
  materialSchema,
  practiceSessionSchema,
  presetSchema,
  semanticNodeSchema,
} from "./domain";

const now = new Date().toISOString();

describe("shared domain schemas", () => {
  it("validates learning", () => {
    const parsed = learningSchema.parse({
      id: crypto.randomUUID(),
      title: "高校数学I_二次関数_第1回",
      subject: "math",
      tags: ["二次関数", "基礎"],
      progress: 0.5,
      createdAt: now,
      updatedAt: now,
    });
    expect(parsed.title).toBe("高校数学I_二次関数_第1回");
  });

  it("validates material", () => {
    const parsed = materialSchema.parse({
      id: crypto.randomUUID(),
      learningId: crypto.randomUUID(),
      type: "pdf",
      sourcePath: "file:///path/to/book.pdf",
      rawContent: "PDF text",
      metadata: { pages: 12, filename: "book.pdf" },
      createdAt: now,
      updatedAt: now,
    });
    expect(parsed.metadata).toHaveProperty("pages", 12);
  });

  it("validates generated content", () => {
    const parsed = generatedContentSchema.parse({
      id: crypto.randomUUID(),
      learningId: crypto.randomUUID(),
      materialId: crypto.randomUUID(),
      type: "qa",
      content: { qa: [{ q: "Q1", a: "A1" }] },
      promptPreset: "math_default",
      createdAt: now,
    });
    expect(parsed.content.qa).toHaveLength(1);
  });

  it("validates practice session", () => {
    const parsed = practiceSessionSchema.parse({
      id: crypto.randomUUID(),
      learningId: crypto.randomUUID(),
      generatedContentId: crypto.randomUUID(),
      questionRef: { id: "q1" },
      answerText: "42",
      isCorrect: true,
      feedback: { reason: "good job" },
      score: 1,
      createdAt: now,
    });
    expect(parsed.isCorrect).toBe(true);
  });

  it("validates preset", () => {
    const parsed = presetSchema.parse({
      id: crypto.randomUUID(),
      subject: "english",
      title: "英単語丁寧モード",
      systemPrompt: "You are a helpful English tutor.",
      userInstructionTemplate: "Give me {count} words.",
      createdAt: now,
      updatedAt: now,
    });
    expect(parsed.subject).toBe("english");
  });

  it("validates semantic node", () => {
    const parsed = semanticNodeSchema.parse({
      id: crypto.randomUUID(),
      refType: "learning",
      refId: crypto.randomUUID(),
      embedding: [0.1, 0.2],
      metadata: { subject: "math" },
    });
    expect(parsed.embedding?.length).toBe(2);
  });
});
