import { randomUUID } from "node:crypto";
import type { D1Database } from "@cloudflare/workers-types";
import type { Material } from "@theteacher/shared";

import type { IngestJob } from "@theteacher/shared";
import { describe, expect, it } from "vitest";

import * as dataModule from "./api/data";
import * as embeddingsModule from "./api/embeddings";
import * as ingestModule from "./api/ingest";
import * as generationModule from "./api/generation";
import * as proxyModule from "./api/proxy";
import { app, __ingestTestHelpers } from "./index";
import * as libraryModule from "./core/library";

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

  it("generates QA, practice, and summary from material with fallback", async () => {
    const res = await app.request("/ai/material/generate", {
      method: "POST",
      body: JSON.stringify({
        materialTitle: "一次関数",
        materialText: "一次関数は y = ax + b の形で表され、a は傾き、b は切片です。",
        qaCount: 2,
        practiceCount: 2,
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.qa)).toBe(true);
    expect(json.qa).toHaveLength(2);
    expect(Array.isArray(json.practice)).toBe(true);
    expect(json.practice).toHaveLength(2);
    expect(json.summary.bullets.length).toBeGreaterThan(0);
  });

  it("proxies generic chat with fallback when no model is configured", async () => {
    const res = await app.request("/ai/chat", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "英単語の覚え方を教えて" }],
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.text).toBe("string");
    expect(json.text.length).toBeGreaterThan(0);
  });

  it("rejects disallowed models for the generic chat proxy", async () => {
    const res = await app.request("/ai/chat", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: "test" }],
      }),
    });
    expect(res.status).toBe(400);
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

  it("uses Vectorize for semantic search when configured", async () => {
    const embedSpy = vi.spyOn(embeddingsModule, "generateEmbeddings").mockResolvedValue({
      embeddings: [[0.1, 0.2, 0.3]],
      dimension: 3,
      provider: "openai",
      model: "text-embedding-3-small",
    });

    const querySpy = vi.fn().mockResolvedValue({
      count: 1,
      matches: [
        {
          id: "learning:abc",
          score: 0.9,
          values: [1, 2, 3],
          metadata: {
            userId: "00000000-0000-4000-8000-000000000000",
            refType: "learning",
            refId: "abc",
            label: "高校数学I: 二次関数",
            excerpt: "二次関数の基本変換",
            subject: "math",
          },
        },
      ],
    });

    const env: any = {
      OPENAI_API_KEY: "sk-test",
      VECTORIZE_INDEX_DIMENSIONS: 3,
      VECTORIZE: {
        query: querySpy,
        upsert: vi.fn(),
        deleteByIds: vi.fn(),
      },
    };

    const res = await app.request(
      "/search/semantic",
      {
        method: "POST",
        body: JSON.stringify({
          query: "二次関数",
          topK: 5,
          refType: "learning",
          subject: "math",
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results).toHaveLength(1);
    expect(json.results[0].refType).toBe("learning");
    expect(json.results[0].subject).toBe("math");
    expect(querySpy).toHaveBeenCalledTimes(1);

    embedSpy.mockRestore();
  });

  it("reindexes semantic nodes into Vectorize", async () => {
    const upsertSpy = vi.fn().mockResolvedValue({ mutationId: "m1" });

    const env: any = {
      OPENAI_API_KEY: "sk-test",
      VECTORIZE_INDEX_DIMENSIONS: 12,
      VECTORIZE: {
        query: vi.fn(),
        upsert: upsertSpy,
        deleteByIds: vi.fn(),
      },
    };

    const res = await app.request("/api/semantic/reindex", { method: "POST" }, env);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.upserted).toBeGreaterThan(0);
    expect(upsertSpy).toHaveBeenCalled();
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

  it("extracts main text with Readability for HTML inputs", () => {
    const html = `<!doctype html>
      <html>
        <head><title>Demo</title></head>
        <body>
          <header>header</header>
          <main>
            <article>
              <h1>見出し</h1>
              <p>これは本文です。これは本文です。これは本文です。</p>
              <p>2つ目の段落です。</p>
            </article>
          </main>
          <footer>footer</footer>
        </body>
      </html>`;
    const text = ingestModule.extractReadableTextFromHtml(html, "https://example.com/article");
    expect(typeof text === "string" || text === null).toBe(true);
    expect(text ?? "").toContain("これは本文です");
    expect(text ?? "").toContain("2つ目の段落です");
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

  it("falls back gracefully when proxy chat LLM fails", async () => {
    const spy = vi.spyOn(proxyModule, "callOpenAiProxyChat").mockResolvedValue(null);
    const res = await app.request("/ai/proxy", {
      method: "POST",
      body: JSON.stringify({ prompt: "代替案を提案して" }),
    });

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.message).toContain("関連候補");
    expect(Array.isArray(json.toolCalls)).toBe(true);
    expect(json.toolCalls.length).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it("returns fallback grading feedback when model errors", async () => {
    const gradingSpy = vi
      .spyOn(generationModule, "gradeWithOpenAi")
      .mockRejectedValue(new Error("grading_failed"));

    const res = await app.request("/ai/practice/grade", {
      method: "POST",
      body: JSON.stringify({
        question: { prompt: "2 + 3 は？", expected: "5" },
        answer: "6",
        mode: "text",
      }),
    });

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.feedback).toBeDefined();
    expect(json.feedback.verdict).toBeDefined();
    expect(json.feedback.usedAi).toBe(false);
    expect(json.feedback.raw).toBe("grading_failed");
    gradingSpy.mockRestore();
  });

  it("keeps the ingest queue running after a failed job", async () => {
    const now = new Date().toISOString();
    const failedJob: IngestJob = {
      id: "job-failed",
      learningId: "learning-1",
      source: { kind: "text", text: "missing material" },
      status: "queued",
      requestedAt: now,
      updatedAt: now,
      steps: [
        { id: "chunk", label: "chunk", kind: "chunking", status: "pending" },
        { id: "embed", label: "embed", kind: "embedding", status: "pending" },
      ],
    };
    const okJob: IngestJob = {
      ...failedJob,
      id: "job-ok",
      source: { kind: "text", text: "チャンク対象の文章" },
    };

    const material: Material = {
      id: "material-ok",
      learningId: okJob.learningId,
      type: "text" as const,
      sourcePath: "local://material",
      rawContent: "これは教材テキストです。",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };

    const fetchIngestJob = vi
      .spyOn(libraryModule, "fetchIngestJob")
      .mockImplementation(async (_db, jobId) => {
        if (jobId === failedJob.id) return { ...failedJob };
        if (jobId === okJob.id) return { ...okJob };
        return null;
      });

    const fetchMaterial = vi
      .spyOn(dataModule, "fetchMaterial")
      .mockImplementation(async (_db, materialId) => {
        if (materialId === material.id) return { ...material };
        return null;
      });

    const saveIngestJob = vi
      .spyOn(libraryModule, "saveIngestJob")
      .mockImplementation(async (_db, job) => job);

    const applyMaterialMetadataPatch = vi
      .spyOn(dataModule, "applyMaterialMetadataPatch")
      .mockResolvedValue(undefined);

    const history: Record<string, IngestJob["status"][]> = {};
    saveIngestJob.mockImplementation(async (_db, job) => {
      history[job.id] = [...(history[job.id] ?? []), job.status];
      return job;
    });

    await Promise.all([
      ingestModule.enqueueIngestJobProcessing({
        db: {} as unknown as D1Database,
        env: {} as never,
        jobId: failedJob.id,
        materialId: "missing-material",
        learningId: failedJob.learningId,
      }),
      ingestModule.enqueueIngestJobProcessing({
        db: {} as unknown as D1Database,
        env: {} as never,
        jobId: okJob.id,
        materialId: material.id,
        learningId: okJob.learningId,
        text: material.rawContent ?? "",
      }),
    ]);

    expect(history[failedJob.id]).toContain("failed");
    expect(history[okJob.id][history[okJob.id].length - 1]).toBe("completed");

    fetchIngestJob.mockRestore();
    fetchMaterial.mockRestore();
    saveIngestJob.mockRestore();
    applyMaterialMetadataPatch.mockRestore();
  });
});
