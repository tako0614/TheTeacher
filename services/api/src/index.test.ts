import { randomUUID } from "node:crypto";

import type { IngestJob } from "@theteacher/shared";
import { describe, expect, it } from "vitest";

import { app, __ingestTestHelpers } from "./index";

const { chunkMaterialText, attachEmbeddingsToChunks, prepareJobForProcessing } = __ingestTestHelpers;

describe("api worker", () => {
  it("responds to /health", async () => {
    const res = await app.request("/health");
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe("ok");
  });

  it("validates /ai/proxy payloads and returns related matches", async () => {
    const bad = await app.request("/ai/proxy", { method: "POST", body: "{}" });
    expect(bad.status).toBe(400);

    const good = await app.request("/ai/proxy", {
      method: "POST",
      body: JSON.stringify({ prompt: "二次関数の復習" }),
    });
    expect(good.status).toBe(200);
    const json = await good.json();
    expect(json.request.prompt).toBe("二次関数の復習");
    expect(json.toolCalls.length).toBeGreaterThan(0);
    expect(json.related.length).toBeGreaterThan(0);
    expect(json.intent).toBeDefined();
    expect(json.message.length).toBeGreaterThan(0);
    expect(json.actions).toBeTypeOf("object");
  });

  it("grades practice answers with fallback when no model is configured", async () => {
    const res = await app.request("/ai/practice/grade", {
      method: "POST",
      body: JSON.stringify({
        question: { prompt: "2 + 2 は？", expected: "4", hint: "簡単な足し算" },
        answer: "4",
        mode: "text",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.feedback.score).toBeGreaterThanOrEqual(0);
    expect(["correct", "partial", "incorrect"]).toContain(json.feedback.verdict);
    expect(typeof json.feedback.comment).toBe("string");
  });

  it("generates embeddings with a deterministic dimension", async () => {
    const res = await app.request("/ai/embed", {
      method: "POST",
      body: JSON.stringify({ texts: ["mock text", "another"] }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.dimension).toBeGreaterThan(4);
    expect(json.embeddings).toHaveLength(2);
    expect(json.embeddings[0]).toHaveLength(json.dimension);
  });

  it("runs semantic search with filtering options", async () => {
    const res = await app.request("/search/semantic", {
      method: "POST",
      body: JSON.stringify({
        query: "二次関数",
        topK: 2,
        refType: "learning",
        subject: "math",
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results.length).toBeLessThanOrEqual(2);
    expect(json.results[0].refType).toBe("learning");
    expect(json.results[0].subject).toBe("math");
  });

  it("provides fallback data for tool-based learning search", async () => {
    const res = await app.request("/ai/tools", {
      method: "POST",
      body: JSON.stringify({ tool: "search_learnings", params: { q: "数学" } }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tool).toBe("search_learnings");
    expect(Array.isArray(json.result.items)).toBe(true);
    expect(json.result.items.length).toBeGreaterThan(0);
  });

  it("chunks long text and attaches embeddings", async () => {
    const payload = Array.from({ length: 40 }, (_, idx) => `Sentence number ${idx + 1}.`).join(" ");
    const chunks = chunkMaterialText(payload, { targetTokens: 10, maxTokens: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].order).toBe(0);
    expect(chunks.every((chunk, index) => chunk.order === index)).toBe(true);
    const { chunks: withEmbeddings, dimension } = await attachEmbeddingsToChunks(chunks);
    expect(withEmbeddings[0].embedding).toBeDefined();
    expect(withEmbeddings[0].embedding?.length).toBe(dimension);
  });

  it("marks preprocessing steps as succeeded when preparing ingest jobs", () => {
    const now = new Date().toISOString();
    const job: IngestJob = {
      id: randomUUID(),
      learningId: randomUUID(),
      source: { kind: "text", text: "demo" } as const,
      status: "queued" as const,
      steps: [
        { id: "download", label: "download", kind: "download", status: "pending" as const },
        { id: "chunk", label: "chunk", kind: "chunking", status: "pending" as const },
        { id: "embed", label: "embed", kind: "embedding", status: "pending" as const },
      ],
      requestedAt: now,
      updatedAt: now,
    };
    const prepared = prepareJobForProcessing(job);
    expect(prepared.status).toBe("processing");
    expect(prepared.steps[0].status).toBe("succeeded");
    expect(prepared.steps[1].status).toBe("running");
    expect(prepared.steps[2].status).toBe("pending");
  });
});
